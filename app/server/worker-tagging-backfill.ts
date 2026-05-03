// PR-2.2: INITIAL_BACKFILL handler.
//
// Drains a single INITIAL_BACKFILL TaggingJob row by iterating every
// active product on the shop and calling generateTagsForProductById
// (the same path SINGLE_PRODUCT uses). Strictly serial — one product
// at a time — matching the worker loop's existing concurrency model.
//
// Cursor-resume: summary.lastProcessedProductId stores the most recent
// successfully-processed product id. On crash → next worker boot's
// sweepStuckTaggingJobs flips RUNNING-with-stale-heartbeat back to
// QUEUED → next claim resumes from the cursor (WHERE id > cursor
// ORDER BY id ASC). Re-tagging an already-tagged product is idempotent
// (the upsert preserves status='APPROVED'/'REJECTED' rows; only
// PENDING_REVIEW gets refreshed), so a duplicate iteration on crash
// recovery costs at most one product's worth of budget.
//
// Mid-run budget gate: cumulative cost is re-fetched from the row
// every 25 products (Risk #7 mitigation — fine-grained per-product
// re-fetch would 25x the DB round-trip count without meaningfully
// improving precision). Cap value cached at handler entry.
//
// Per-product failure isolation: a failed Anthropic call (any
// errorClass) increments failedProducts and continues. The whole
// backfill only fails on systemic problems (DB unreachable, etc.).
//
// shouldStop is checked at the TOP of each iteration. Mid-product
// SIGTERM is intentionally not honored — the per-product Anthropic
// call is allowed to finish so we don't waste tokens already paid for.
// On shouldStop exit, the row is left RUNNING with stale heartbeat;
// the next boot's sweep + cursor-resume picks it up.

import type { Prisma, TaggingJob } from "@prisma/client";
import prisma from "../db.server";
import { generateTagsForProductById } from "../lib/catalog/ai-tagger.server";
import {
  finishTaggingJob,
  heartbeatTaggingJob,
} from "../lib/catalog/tagging-jobs.server";
import {
  computeCostFromUsage,
  getBackfillBudgetMicros,
  recordCost,
} from "../lib/catalog/tagging-cost.server";
import { log } from "./worker-logger";

// How many products between mid-run budget re-fetches.
const BUDGET_RECHECK_INTERVAL = 25;

// Mirrors the budget-warning threshold in tagging-cost.server.ts.
const BUDGET_WARN_FRACTION = 0.8;

type BackfillSummary = {
  kind: "INITIAL_BACKFILL";
  totalProducts?: number;
  lastProcessedProductId?: string | null;
  limit?: number | null;
  startedAt?: string;
  completedAt?: string;
  outcome?: "succeeded" | "budget_paused" | "shouldStop_exit" | "failed";
  errorCounts?: Record<string, number>;
};

export type ProcessInitialBackfillResult =
  | { outcome: "succeeded"; processed: number; failed: number; costMicros: bigint }
  | { outcome: "budget_paused"; processed: number; failed: number; costMicros: bigint }
  | { outcome: "shouldStop_exit"; processed: number; failed: number; costMicros: bigint }
  | { outcome: "failed"; processed: number; failed: number; costMicros: bigint; message: string };

export async function processInitialBackfill(params: {
  job: TaggingJob;
  shouldStop: () => boolean;
}): Promise<ProcessInitialBackfillResult> {
  const { job, shouldStop } = params;
  const summary = (job.summary ?? {}) as BackfillSummary;
  const limit = typeof summary.limit === "number" && summary.limit > 0 ? summary.limit : null;
  const cursor = summary.lastProcessedProductId ?? null;
  const capMicros = getBackfillBudgetMicros();
  const startedAtIso = summary.startedAt ?? new Date().toISOString();

  // Count active products (totalProducts target). Excludes deleted.
  // Includes ARCHIVED status? No — only ACTIVE products tag. Match the
  // existing SINGLE_PRODUCT path which doesn't tag ARCHIVED products.
  const total = await prisma.product.count({
    where: {
      shopDomain: job.shopDomain,
      deletedAt: null,
      status: "ACTIVE",
    },
  });

  // Cap by --limit if set (limit can't exceed total naturally).
  const target = limit !== null ? Math.min(limit, total) : total;

  // Persist totalProducts and startedAt on the row immediately so the
  // reporter can read them even if we crash mid-run.
  await prisma.taggingJob.update({
    where: { id: job.id },
    data: {
      totalProducts: target,
      summary: mergeSummary(summary, {
        kind: "INITIAL_BACKFILL",
        totalProducts: target,
        startedAt: startedAtIso,
        limit: limit ?? undefined,
      }),
    },
  });

  log.info("backfill started", {
    event: "backfill_started",
    jobId: job.id,
    shopDomain: job.shopDomain,
    totalProducts: target,
    limit,
    resumedFromCursor: cursor !== null,
  });

  // Local error-class counter; persisted to summary on completion.
  const errorCounts: Record<string, number> = {
    RATE_LIMIT: 0,
    AUTH: 0,
    MALFORMED_JSON: 0,
    CONNECTION: 0,
    OTHER: 0,
  };

  let processed = job.processedProducts ?? 0;
  let failed = job.failedProducts ?? 0;
  let lastProcessedId: string | null = cursor;
  let warnedThisRun = false;
  let iterationsSinceCheck = 0;
  let budgetPaused = false;
  let costSoFar: bigint = job.costUsdMicros ?? 0n;

  // Stream-paginate active products in id-ASC order so the cursor
  // semantics work. Page size 100 — keeps memory bounded for
  // multi-thousand-product catalogs without thrashing the DB.
  const PAGE_SIZE = 100;

  outer: while (!shouldStop() && processed + failed < target) {
    const batch = await prisma.product.findMany({
      where: {
        shopDomain: job.shopDomain,
        deletedAt: null,
        status: "ACTIVE",
        ...(lastProcessedId !== null ? { id: { gt: lastProcessedId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });

    if (batch.length === 0) break; // exhausted

    for (const row of batch) {
      if (shouldStop()) break outer;
      if (processed + failed >= target) break outer;

      // Heartbeat before the Anthropic call — keeps the stuck-job
      // sweep from firing during a slow LLM response.
      await heartbeatTaggingJob(job.id);

      // Mid-run budget check every BUDGET_RECHECK_INTERVAL products.
      // Cap value cached above; only the cumulative cost is re-fetched.
      if (iterationsSinceCheck >= BUDGET_RECHECK_INTERVAL) {
        const fresh = await prisma.taggingJob.findUnique({
          where: { id: job.id },
          select: { costUsdMicros: true },
        });
        if (fresh) costSoFar = fresh.costUsdMicros;
        iterationsSinceCheck = 0;

        const fraction = capMicros > 0n
          ? Number((costSoFar * 10000n) / capMicros) / 10000
          : 0;
        if (!warnedThisRun && fraction >= BUDGET_WARN_FRACTION && fraction < 1) {
          log.warn("backfill budget warning", {
            event: "backfill_budget_warning",
            jobId: job.id,
            shopDomain: job.shopDomain,
            costUsdMicros: costSoFar.toString(),
            capUsdMicros: capMicros.toString(),
            fraction,
          });
          warnedThisRun = true;
        }
        if (costSoFar >= capMicros) {
          log.warn("backfill budget paused", {
            event: "backfill_budget_paused",
            jobId: job.id,
            shopDomain: job.shopDomain,
            costUsdMicros: costSoFar.toString(),
            capUsdMicros: capMicros.toString(),
          });
          budgetPaused = true;
          break outer;
        }
      }

      // Per-product call — same code path as SINGLE_PRODUCT.
      let result;
      try {
        result = await generateTagsForProductById({
          shopDomain: job.shopDomain,
          productId: row.id,
        });
      } catch (err) {
        // Hard exception (DB error, unexpected throw) — treat as
        // OTHER, count as failure, continue.
        failed += 1;
        errorCounts.OTHER += 1;
        log.error("backfill product threw", {
          event: "backfill_product_exception",
          jobId: job.id,
          shopDomain: job.shopDomain,
          productId: row.id,
          message: err instanceof Error ? err.message : String(err),
        });
        lastProcessedId = row.id;
        await persistIterationState(job.id, lastProcessedId, processed, failed, summary);
        iterationsSinceCheck += 1;
        continue;
      }

      // Record cost regardless of outcome — Anthropic charges for
      // partial responses on failed parses too.
      const { costMicros } = computeCostFromUsage(
        result.model,
        result.inputTokens,
        result.outputTokens,
      );
      if (costMicros > 0n) {
        await recordCost({
          jobId: job.id,
          costMicros,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
        costSoFar = costSoFar + costMicros;
      }

      if (result.ok) {
        processed += 1;
      } else {
        failed += 1;
        const cls = result.errorClass;
        errorCounts[cls] = (errorCounts[cls] ?? 0) + 1;
        log.warn("backfill product failed", {
          event: "backfill_product_failed",
          jobId: job.id,
          shopDomain: job.shopDomain,
          productId: row.id,
          errorClass: cls,
          message: result.error,
        });
      }

      lastProcessedId = row.id;
      iterationsSinceCheck += 1;
      await persistIterationState(job.id, lastProcessedId, processed, failed, summary);

      // Progress log every BUDGET_RECHECK_INTERVAL products.
      if ((processed + failed) % BUDGET_RECHECK_INTERVAL === 0) {
        const percent = target > 0 ? Math.round(((processed + failed) / target) * 1000) / 10 : 0;
        log.info("backfill progress", {
          event: "backfill_progress",
          jobId: job.id,
          shopDomain: job.shopDomain,
          processed,
          failed,
          costUsdMicros: costSoFar.toString(),
          percentComplete: percent,
        });
      }
    }
  }

  const stoppedEarly = shouldStop();
  const completedAtIso = new Date().toISOString();
  const finalSummary: BackfillSummary = {
    ...summary,
    kind: "INITIAL_BACKFILL",
    totalProducts: target,
    lastProcessedProductId: lastProcessedId,
    startedAt: startedAtIso,
    completedAt: completedAtIso,
    errorCounts,
  };

  if (budgetPaused) {
    finalSummary.outcome = "budget_paused";
    await finishTaggingJob(job.id, {
      status: "BUDGET_PAUSED",
      errorClass: "OTHER",
      errorMessage: "Backfill cap exceeded",
      summary: finalSummary as Prisma.InputJsonValue,
    });
    log.info("backfill completed (budget_paused)", {
      event: "backfill_completed",
      jobId: job.id,
      shopDomain: job.shopDomain,
      totalProducts: target,
      processedProducts: processed,
      failedProducts: failed,
      totalCostUsdMicros: costSoFar.toString(),
      durationMs: msSince(startedAtIso),
      outcome: "budget_paused",
    });
    return { outcome: "budget_paused", processed, failed, costMicros: costSoFar };
  }

  if (stoppedEarly && processed + failed < target) {
    // Leave job RUNNING with stale heartbeat. Sweep on next boot will
    // reset to QUEUED and resume from cursor.
    log.info("backfill paused (shouldStop)", {
      event: "backfill_shouldstop_exit",
      jobId: job.id,
      shopDomain: job.shopDomain,
      processed,
      failed,
      lastProcessedProductId: lastProcessedId,
    });
    return { outcome: "shouldStop_exit", processed, failed, costMicros: costSoFar };
  }

  // Loop exhausted naturally — limit hit OR all products consumed.
  finalSummary.outcome = "succeeded";
  await finishTaggingJob(job.id, {
    status: "SUCCEEDED",
    summary: finalSummary as Prisma.InputJsonValue,
  });
  log.info("backfill completed", {
    event: "backfill_completed",
    jobId: job.id,
    shopDomain: job.shopDomain,
    totalProducts: target,
    processedProducts: processed,
    failedProducts: failed,
    totalCostUsdMicros: costSoFar.toString(),
    durationMs: msSince(startedAtIso),
    outcome: "succeeded",
  });
  return { outcome: "succeeded", processed, failed, costMicros: costSoFar };
}

// Persist cursor + counts after each iteration. Two-write granularity
// per product (recordCost + this update). Keeps DB load reasonable
// while losing at most one product's worth of work on crash.
async function persistIterationState(
  jobId: string,
  lastProcessedProductId: string,
  processed: number,
  failed: number,
  baseSummary: BackfillSummary,
): Promise<void> {
  await prisma.taggingJob.update({
    where: { id: jobId },
    data: {
      processedProducts: processed,
      failedProducts: failed,
      summary: mergeSummary(baseSummary, {
        kind: "INITIAL_BACKFILL",
        lastProcessedProductId,
      }),
    },
  });
}

// Merge two summary fragments. Newer values win; nulls are preserved
// only if explicitly set (undefined drops the field).
function mergeSummary(
  base: BackfillSummary,
  patch: BackfillSummary,
): Prisma.InputJsonValue {
  const merged: BackfillSummary = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) {
      (merged as Record<string, unknown>)[k] = v;
    }
  }
  return merged as Prisma.InputJsonValue;
}

function msSince(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}
