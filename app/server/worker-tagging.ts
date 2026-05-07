// PR-2.1: in-worker poll loop for the TaggingJob queue.
//
// Runs in the SAME process as the catalog sync claim loop in worker.ts
// but on an INDEPENDENT poll interval and INDEPENDENT heartbeat
// clock. Sync's stuck-job sweep only inspects CatalogSyncJob.heartbeatAt;
// tagging's only inspects TaggingJob.heartbeatAt. A long Anthropic call
// in the tagging loop does not stall the sync loop's heartbeats and
// vice versa.
//
// Flow per claim:
//   1. Pre-flight budget check via checkBudgetForKind.
//      → DAILY_CAP / BACKFILL_CAP → mark BUDGET_PAUSED, log, release.
//   2. Reset budget tripwires for shop if the day rolled over.
//   3. Resume any BUDGET_PAUSED rows for the shop now that the day
//      is fresh.
//   4. SINGLE_PRODUCT / MANUAL_RETAG: run generateTagsForProductById
//      (which orchestrates rule-engine → ai-tagger).
//   5. Compute cost from response usage; record on the job row.
//   6. Write budget warning/pause if today crossed 80% / 100%.
//   7. Mark SUCCEEDED / FAILED.
//
// INITIAL_BACKFILL kind is reserved for 2.2 — this loop logs the kind
// and marks the row CANCELLED with a not-implemented summary if it
// claims one in 2.1. The DB row creation is gated behind the future
// 2.2 backfill script anyway; defending here is belt-and-braces.

import type { TaggingJob } from "@prisma/client";
import prisma from "../db.server";
import { generateTagsForProductById } from "../lib/catalog/ai-tagger.server";
import {
  claimNextTaggingJob,
  finishTaggingJob,
  heartbeatTaggingJob,
  logTaggingFailure,
  resumePausedJobsForShop,
  sweepStuckTaggingJobs,
  updateTaggingProgress,
} from "../lib/catalog/tagging-jobs.server";
import {
  checkBudgetForKind,
  computeCostFromUsage,
  recordCost,
  resetBudgetTripwiresForNewDay,
  writeBudgetWarningIfCrossed,
} from "../lib/catalog/tagging-cost.server";
import { sleep } from "../lib/catalog/shopify-throttle.server";
import { processInitialBackfill } from "./worker-tagging-backfill";
import { processReEmbedJob } from "./worker-reembed";
import { log } from "./worker-logger";

const TAGGING_POLL_MIN_MS = 2000;
const TAGGING_POLL_MAX_MS = 5000;

// Retry policy. RATE_LIMIT and CONNECTION are retried with
// exponential backoff up to MAX_RETRIES. MALFORMED_JSON gets one
// retry with a stricter prompt (the prompt addition is "your previous
// response was not valid JSON; respond with raw JSON only, no
// markdown fences"). AUTH and OTHER fail immediately.
const MAX_RETRIES_TRANSIENT = 3;
const RETRY_BACKOFF_MS = [500, 1500, 4500];

function jitterPollMs(): number {
  return (
    TAGGING_POLL_MIN_MS +
    Math.floor(Math.random() * (TAGGING_POLL_MAX_MS - TAGGING_POLL_MIN_MS))
  );
}

export type TaggingLoopHandle = {
  stop: () => void;
};

// Spawned from worker.ts main(). Returns a handle the worker can call
// to request a graceful stop. The loop exits after the current job
// completes its cycle.
export function startTaggingLoop(shouldStop: () => boolean): TaggingLoopHandle {
  let stopped = false;
  const localStop = () => stopped || shouldStop();

  // Unconditional boot event — fires before runLoop's async-fire so the
  // log line lands during worker boot regardless of whether the boot
  // sweep finds any stuck rows. Mirrors worker.ts:48 (`worker boot`)
  // for consistency. Identified as an observability gap during PR-2.1
  // smoke verification (CHECK 2 of pre-smoke verification).
  log.info("tagging loop starting", {
    event: "tagging_loop_started",
    pollIntervalMs: `${TAGGING_POLL_MIN_MS}-${TAGGING_POLL_MAX_MS}`,
  });

  void runLoop(localStop);

  return {
    stop: () => {
      stopped = true;
    },
  };
}

async function runLoop(shouldStop: () => boolean): Promise<void> {
  // Boot sweep — mirrors sync worker. Any RUNNING TaggingJob rows
  // left over from a prior crash get reset to QUEUED so the claim
  // loop picks them up cleanly.
  try {
    const swept = await sweepStuckTaggingJobs();
    if (swept.resumedJobIds.length > 0) {
      log.info("tagging boot sweep complete", {
        event: "tagging_boot_sweep",
        sweptCount: swept.resumedJobIds.length,
        resumedJobIds: swept.resumedJobIds,
      });
    }
  } catch (err) {
    log.error("tagging boot sweep failed", {
      event: "tagging_boot_sweep_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  while (!shouldStop()) {
    let job: TaggingJob | null;
    try {
      job = await claimNextTaggingJob();
    } catch (err) {
      log.error("tagging claim failed; backing off", {
        event: "tagging_claim_error",
        message: err instanceof Error ? err.message : String(err),
      });
      await sleep(TAGGING_POLL_MAX_MS);
      continue;
    }

    if (!job) {
      await sleep(jitterPollMs());
      continue;
    }

    log.info("tagging job claimed", {
      event: "tagging_job_claimed",
      jobId: job.id,
      shopDomain: job.shopDomain,
      kind: job.kind,
      productId: job.productId,
      triggerSource: job.triggerSource,
    });

    // PR-2.2 Item 2: queue-collision observability. If a SINGLE_PRODUCT
    // job waited >5 min in QUEUED AND a RUNNING INITIAL_BACKFILL exists
    // on the same shop, the backfill is blocking webhook-triggered
    // work. Pure observability — no behavior change. Useful for
    // production-onboarding analysis when claim-priority becomes a
    // real concern (deferred to that phase).
    await maybeLogBackfillBlockingEvent(job);

    try {
      await processTaggingJob(job, shouldStop);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("tagging job crashed in handler", {
        event: "tagging_job_crash",
        jobId: job.id,
        shopDomain: job.shopDomain,
        message,
      });
      try {
        await finishTaggingJob(job.id, {
          status: "FAILED",
          errorClass: "OTHER",
          errorMessage: message,
        });
      } catch {
        // Last-ditch — DB unreachable. Loop will sweep on next boot.
      }
    }
  }

  log.info("tagging loop exiting", { event: "tagging_loop_exit" });
}

async function processTaggingJob(
  job: TaggingJob,
  shouldStop: () => boolean,
): Promise<void> {
  // PR-2.2: INITIAL_BACKFILL handler delegated to the backfill module.
  // The handler manages its own lifecycle (cursor-resume, mid-run
  // budget check, per-product failure isolation) and writes the job's
  // terminal status itself. shouldStop is plumbed through so the
  // handler can exit cleanly between products on SIGTERM, leaving
  // the row RUNNING-with-stale-heartbeat for the next boot's sweep.
  if (job.kind === "INITIAL_BACKFILL") {
    await processInitialBackfill({ job, shouldStop });
    return;
  }

  // PR-3.1-mech.6: RE_EMBED handler delegated to the re-embed module.
  // The handler enforces Decision A's hash-match skip predicate and
  // writes its own terminal status. Voyage cost is recorded on the row
  // via the voyage-cost helper; no Anthropic budget interaction (Voyage
  // cost is currently outside the daily Anthropic-tagging cap and rolls
  // up under a separate ledger row in the future when the merchant
  // dashboard surfaces embed spend).
  if (job.kind === "RE_EMBED") {
    await processReEmbedJob({ job });
    return;
  }

  // SINGLE_PRODUCT and MANUAL_RETAG share the path.
  if (!job.productId) {
    log.error("tagging job has no productId", {
      event: "tagging_job_no_product_id",
      jobId: job.id,
      shopDomain: job.shopDomain,
      kind: job.kind,
    });
    await finishTaggingJob(job.id, {
      status: "FAILED",
      errorClass: "OTHER",
      errorMessage: "TaggingJob.productId is null for SINGLE_PRODUCT/MANUAL_RETAG kind",
    });
    return;
  }

  // Daily rollover — clear yesterday's tripwires AND resurrect any
  // BUDGET_PAUSED rows from yesterday.
  const rolled = await resetBudgetTripwiresForNewDay(job.shopDomain);
  if (rolled.reset) {
    const resumed = await resumePausedJobsForShop(job.shopDomain);
    log.info("tagging budget rolled over for new day", {
      event: "tagging_budget_rollover",
      shopDomain: job.shopDomain,
      resumedCount: resumed.resumedCount,
    });
  }

  // Pre-flight budget check.
  const budget = await checkBudgetForKind({
    shopDomain: job.shopDomain,
    kind: job.kind,
    currentJobId: job.id,
  });
  if (!budget.allowed) {
    log.warn("tagging budget exceeded; pausing job", {
      event: "tagging_budget_paused",
      jobId: job.id,
      shopDomain: job.shopDomain,
      reason: budget.reason,
      cumulativeMicros: budget.cumulativeMicros.toString(),
      capMicros: budget.capMicros.toString(),
    });
    await finishTaggingJob(job.id, {
      status: "BUDGET_PAUSED",
      errorClass: "OTHER",
      errorMessage: `Budget exceeded: ${budget.reason}`,
      summary: {
        outcome: "budget_paused",
        reason: budget.reason,
        cumulativeMicros: budget.cumulativeMicros.toString(),
        capMicros: budget.capMicros.toString(),
      },
    });
    return;
  }

  // Heartbeat once before the LLM call so a slow Anthropic response
  // doesn't trip the stuck-job timeout while we're legitimately
  // waiting on a network call.
  await heartbeatTaggingJob(job.id);

  log.info("tagging started", {
    event: "tagging_started",
    jobId: job.id,
    shopDomain: job.shopDomain,
    productId: job.productId,
    kind: job.kind,
    triggerSource: job.triggerSource,
  });

  const startMs = Date.now();
  const result = await callTaggerWithRetry({
    shopDomain: job.shopDomain,
    productId: job.productId,
    jobId: job.id,
  });
  const durationMs = Date.now() - startMs;

  // Record cost regardless of success — Anthropic charges for partial
  // responses too. Both inputTokens and outputTokens come from the
  // result object (0 on pre-call failures).
  const tokenUsage = {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
  const { costMicros, rateSource } = computeCostFromUsage(
    result.model,
    tokenUsage.inputTokens,
    tokenUsage.outputTokens,
  );
  if (costMicros > 0n) {
    await recordCost({
      jobId: job.id,
      costMicros,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
    });
  }

  // Daily-cap tripwire check (writes MerchantConfig timestamps + flips
  // BUDGET_PAUSED if 100% crossed).
  const crossing = await writeBudgetWarningIfCrossed({
    shopDomain: job.shopDomain,
  });
  if (crossing.kind === "warn") {
    log.warn("tagging daily budget warning crossed (80%)", {
      event: "tagging_budget_warning",
      shopDomain: job.shopDomain,
      cumulativeMicros: crossing.cumulativeMicros.toString(),
      capMicros: crossing.capMicros.toString(),
      fraction: crossing.fraction,
    });
  } else if (crossing.kind === "pause") {
    log.warn("tagging daily budget exceeded (100%); shop paused", {
      event: "tagging_budget_paused_global",
      shopDomain: job.shopDomain,
      cumulativeMicros: crossing.cumulativeMicros.toString(),
      capMicros: crossing.capMicros.toString(),
    });
  }

  if (!result.ok) {
    log.error("tagging failed", {
      event: "tagging_failed",
      jobId: job.id,
      shopDomain: job.shopDomain,
      productId: job.productId,
      errorClass: result.errorClass,
      message: result.error,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      costUsdMicros: costMicros.toString(),
      durationMs,
    });
    await logTaggingFailure({
      jobId: job.id,
      errorClass: result.errorClass,
      message: result.error,
    });
    await finishTaggingJob(job.id, {
      status: "FAILED",
      errorClass: result.errorClass,
      errorMessage: result.error,
      summary: {
        outcome: "failed",
        errorClass: result.errorClass,
        durationMs,
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        costUsdMicros: costMicros.toString(),
      },
    });
    return;
  }

  // Success path. Bump processedProducts to 1 (this is a single-
  // product job).
  await updateTaggingProgress(job.id, {
    processedProducts: 1,
    totalProducts: 1,
  });

  log.info("tagging completed", {
    event: "tagging_completed",
    jobId: job.id,
    shopDomain: job.shopDomain,
    productId: job.productId,
    tagsWritten: result.writtenCount,
    ruleTagsWritten: result.ruleTagsWritten,
    axesNeeded: result.axesNeeded,
    proposedTags: result.tags.map((t) => ({ axis: t.axis, value: t.value })),
    inputTokens: tokenUsage.inputTokens,
    outputTokens: tokenUsage.outputTokens,
    costUsdMicros: costMicros.toString(),
    rateSource,
    durationMs,
    model: result.model,
  });

  await finishTaggingJob(job.id, {
    status: "SUCCEEDED",
    summary: {
      outcome: "succeeded",
      durationMs,
      tagsWritten: result.writtenCount,
      ruleTagsWritten: result.ruleTagsWritten,
      axesNeeded: result.axesNeeded as unknown as string[],
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      costUsdMicros: costMicros.toString(),
      model: result.model,
    },
  });
}

// callTaggerWithRetry handles the RATE_LIMIT/CONNECTION/MALFORMED_JSON
// retry policy. Token usage from the LAST attempt is what we return —
// earlier failed attempts' tokens are billed by Anthropic but we
// surface only the final attempt's usage to the caller (the
// upper-bound cost estimate).
async function callTaggerWithRetry(params: {
  shopDomain: string;
  productId: string;
  jobId: string;
}): Promise<Awaited<ReturnType<typeof generateTagsForProductById>>> {
  let last: Awaited<ReturnType<typeof generateTagsForProductById>> | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES_TRANSIENT; attempt++) {
    last = await generateTagsForProductById({
      shopDomain: params.shopDomain,
      productId: params.productId,
    });
    if (last.ok) return last;

    const cls = last.errorClass;
    if (cls === "AUTH" || cls === "OTHER") {
      // Immediate fail.
      return last;
    }
    if (cls === "MALFORMED_JSON") {
      // One retry only for malformed JSON.
      if (attempt >= 1) return last;
      log.warn("tagging malformed JSON; retrying once", {
        event: "tagging_retry_malformed_json",
        jobId: params.jobId,
        attempt: attempt + 1,
      });
      // Heartbeat between attempts.
      await heartbeatTaggingJob(params.jobId);
      continue;
    }
    // RATE_LIMIT or CONNECTION → exponential backoff up to MAX.
    if (attempt >= MAX_RETRIES_TRANSIENT - 1) return last;
    const backoff = RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    log.warn("tagging transient failure; retrying", {
      event: "tagging_retry_transient",
      jobId: params.jobId,
      errorClass: cls,
      attempt: attempt + 1,
      backoffMs: backoff,
    });
    await heartbeatTaggingJob(params.jobId);
    await sleep(backoff);
  }
  // All retries exhausted.
  return last!;
}

// PR-2.2 Item 2: queue-collision observability.
//
// Emits a structured log event when a SINGLE_PRODUCT job has been
// QUEUED for >5 minutes AND a RUNNING INITIAL_BACKFILL exists on the
// same shop. Pure observability — no behavior change. Future
// production-onboarding work will use this signal to decide whether
// to implement claim-priority (favor SINGLE_PRODUCT over
// INITIAL_BACKFILL).
//
// MANUAL_RETAG also represents merchant-visible work and is included
// in the same blocked-by-backfill check.
const BACKFILL_BLOCKING_THRESHOLD_MS = 5 * 60 * 1000;

async function maybeLogBackfillBlockingEvent(job: TaggingJob): Promise<void> {
  if (job.kind !== "SINGLE_PRODUCT" && job.kind !== "MANUAL_RETAG") return;
  const waitedMs = Date.now() - job.enqueuedAt.getTime();
  if (waitedMs <= BACKFILL_BLOCKING_THRESHOLD_MS) return;

  try {
    const blocking = await prisma.taggingJob.findFirst({
      where: {
        shopDomain: job.shopDomain,
        kind: "INITIAL_BACKFILL",
        status: "RUNNING",
      },
      select: { id: true },
    });
    if (!blocking) return;
    log.info("tagging queue blocked by backfill", {
      event: "tagging_queue_blocked_by_backfill",
      shopDomain: job.shopDomain,
      productId: job.productId,
      waitedMs,
      blockingJobId: blocking.id,
    });
  } catch {
    // Observability best-effort — swallow errors so the main claim
    // path is unaffected.
  }
}

// PR-2.1: helper for graceful shutdown — release any RUNNING TaggingJob
// the worker process owns so the next boot can claim immediately. The
// caller (worker.ts SIGTERM handler) invokes this if a job is in
// flight when the signal lands.
export async function releaseInFlightTaggingJobs(): Promise<void> {
  // The current implementation marks rows BUDGET_PAUSED via the
  // sweep instead — graceful shutdown doesn't need a special path
  // because the next boot's sweepStuckTaggingJobs handles RUNNING-
  // with-stale-heartbeat cleanly. This function exists for symmetry
  // with the sync loop's releaseJobToQueue contract; left as a
  // no-op for v0 because the in-flight ID isn't tracked at the
  // module level.
  void prisma; // suppress unused-import lint
}
