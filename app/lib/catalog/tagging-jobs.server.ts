// PR-2.1: DB-backed primitives for the TaggingJob queue.
//
// Mirrors sync-jobs.server.ts (PR-A) for the tagging queue. Differences:
//   - Separate model (TaggingJob, not CatalogSyncJob) so cost tracking
//     and failure isolation stay per-feature.
//   - Per-product partial unique index on (shopDomain, productId)
//     WHERE status='QUEUED' enforces dedup at the DB layer; the
//     enqueue helper (enqueue-tagging.server.ts) checks first to
//     avoid raising on the constraint, but the DB still wins on race.
//   - Independent heartbeat clock from the sync loop. Worker process
//     runs both loops; tagging's RUNNING heartbeat is unrelated to
//     sync's RUNNING heartbeat.
//
// Reuses KNOWLEDGE_WORKER_HEARTBEAT_TIMEOUT_MS from sync-jobs.server
// (same operational signal — "how long can a worker hold a job before
// we assume it's dead"). One env var, two queues.

import type {
  Prisma,
  TaggingJob,
  TaggingJobKind,
  TaggingJobStatus,
} from "@prisma/client";
import prisma from "../../db.server";
import { getHeartbeatTimeoutMs } from "./sync-jobs.server";

// --- claimNextTaggingJob -------------------------------------------------
//
// FOR UPDATE SKIP LOCKED claim. Same pattern as sync-jobs.claimNextJob.
// Restricts to status='QUEUED' and the three kinds the tagging worker
// owns (SINGLE_PRODUCT, INITIAL_BACKFILL, MANUAL_RETAG). BUDGET_PAUSED
// rows are NOT claimable — the daily reset path resurrects them by
// flipping back to QUEUED.
export async function claimNextTaggingJob(): Promise<TaggingJob | null> {
  const rows = await prisma.$queryRaw<TaggingJob[]>`
    WITH cte AS (
      SELECT tj.id
      FROM "TaggingJob" tj
      WHERE tj.status = 'QUEUED'
        AND tj.kind IN ('SINGLE_PRODUCT', 'INITIAL_BACKFILL', 'MANUAL_RETAG')
      ORDER BY tj."enqueuedAt"
      FOR UPDATE OF tj SKIP LOCKED
      LIMIT 1
    )
    UPDATE "TaggingJob" tj
    SET status = 'RUNNING',
        "startedAt" = COALESCE(tj."startedAt", NOW()),
        "heartbeatAt" = NOW(),
        "updatedAt" = NOW()
    FROM cte
    WHERE tj.id = cte.id
    RETURNING tj.*
  `;
  return rows[0] ?? null;
}

// --- heartbeat / progress ------------------------------------------------

export async function heartbeatTaggingJob(jobId: string): Promise<void> {
  await prisma.taggingJob.update({
    where: { id: jobId },
    data: { heartbeatAt: new Date() },
  });
}

export type TaggingProgressUpdate = {
  totalProducts?: number;
  processedProducts?: number;
  failedProducts?: number;
  skippedProducts?: number;
};

export async function updateTaggingProgress(
  jobId: string,
  update: TaggingProgressUpdate,
): Promise<void> {
  await prisma.taggingJob.update({
    where: { id: jobId },
    data: {
      ...update,
      heartbeatAt: new Date(),
    },
  });
}

// --- finishTaggingJob ----------------------------------------------------

export async function finishTaggingJob(
  jobId: string,
  outcome: {
    status: Extract<TaggingJobStatus, "SUCCEEDED" | "FAILED" | "CANCELLED" | "BUDGET_PAUSED">;
    summary?: Prisma.InputJsonValue;
    errorClass?: string;
    errorMessage?: string;
  },
): Promise<void> {
  await prisma.taggingJob.update({
    where: { id: jobId },
    data: {
      status: outcome.status,
      finishedAt: new Date(),
      summary: outcome.summary,
      errorClass: outcome.errorClass,
      errorMessage: outcome.errorMessage,
    },
  });
}

// --- logTaggingFailure ---------------------------------------------------
//
// Increments the row's errorCount and writes the error class/message.
// Unlike CatalogSyncJob which has a sibling CatalogSyncJobFailure
// table, tagging keeps the error surface on the row itself — per-job
// failures are coarser-grained (one product per row) and the row IS
// the unit of investigation.
export async function logTaggingFailure(params: {
  jobId: string;
  errorClass: string;
  message: string;
}): Promise<void> {
  const truncated =
    params.message.length > 1024
      ? params.message.slice(0, 1024) + "…"
      : params.message;
  await prisma.taggingJob.update({
    where: { id: params.jobId },
    data: {
      errorCount: { increment: 1 },
      errorClass: params.errorClass,
      errorMessage: truncated,
    },
  });
}

// --- sweepStuckTaggingJobs ----------------------------------------------
//
// Mirrors sync-jobs.sweepStuckJobs. Resets RUNNING jobs with stale
// heartbeats back to QUEUED so the next claim resumes them. Anthropic
// calls are idempotent at the (productId, axesNeeded) level — the
// rule engine + ai-tagger.upsert path skips writes for tags that
// already exist with the same value.
export async function sweepStuckTaggingJobs(
  timeoutMs: number = getHeartbeatTimeoutMs(),
): Promise<{ resumedJobIds: string[] }> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const stuck = await prisma.taggingJob.findMany({
    where: {
      status: "RUNNING",
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }],
    },
    select: { id: true },
  });
  if (stuck.length === 0) return { resumedJobIds: [] };
  const ids = stuck.map((s) => s.id);
  await prisma.taggingJob.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "QUEUED",
      heartbeatAt: null,
    },
  });
  return { resumedJobIds: ids };
}

// --- releaseTaggingJobToQueue -------------------------------------------
//
// Graceful-shutdown path. SIGTERM mid-RUNNING flips back to QUEUED so
// the next worker boot can claim immediately without waiting for the
// heartbeat sweep. Mirrors sync-jobs.releaseJobToQueue.
export async function releaseTaggingJobToQueue(
  jobId: string,
  options?: { tx?: Prisma.TransactionClient },
): Promise<{ released: boolean }> {
  const tx = options?.tx ?? prisma;
  const job = await tx.taggingJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!job) {
    throw new Error(`releaseTaggingJobToQueue: job ${jobId} not found`);
  }
  if (job.status === "QUEUED") {
    return { released: false };
  }
  if (job.status !== "RUNNING") {
    throw new Error(
      `releaseTaggingJobToQueue: job ${jobId} is ${job.status}, refusing to resurrect`,
    );
  }
  await tx.taggingJob.update({
    where: { id: jobId },
    data: { status: "QUEUED", heartbeatAt: null },
  });
  return { released: true };
}

// --- read-side helpers ---------------------------------------------------

export async function getTaggingJobById(jobId: string): Promise<TaggingJob | null> {
  return prisma.taggingJob.findUnique({ where: { id: jobId } });
}

export async function findQueuedJobForProduct(
  shopDomain: string,
  productId: string,
): Promise<TaggingJob | null> {
  return prisma.taggingJob.findFirst({
    where: {
      shopDomain,
      productId,
      status: "QUEUED",
    },
    orderBy: { enqueuedAt: "desc" },
  });
}

export async function getMostRecentFinishedTaggingJob(
  shopDomain: string,
  productId: string,
): Promise<TaggingJob | null> {
  return prisma.taggingJob.findFirst({
    where: {
      shopDomain,
      productId,
      status: { in: ["SUCCEEDED", "FAILED", "CANCELLED", "BUDGET_PAUSED"] },
    },
    orderBy: { finishedAt: "desc" },
  });
}

// --- cancelTaggingJobsForProduct ----------------------------------------
//
// Used by the deletion path (PRODUCTS_DELETE webhook) — if a product
// is being deleted, in-flight tagging for it is wasted work. Marks
// QUEUED + RUNNING rows CANCELLED.
export async function cancelTaggingJobsForProduct(params: {
  shopDomain: string;
  productId: string;
  tx?: Prisma.TransactionClient;
}): Promise<{ cancelledCount: number }> {
  const tx = params.tx ?? prisma;
  const result = await tx.taggingJob.updateMany({
    where: {
      shopDomain: params.shopDomain,
      productId: params.productId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "CANCELLED",
      finishedAt: new Date(),
      errorMessage: "Cancelled because product was deleted or superseded",
    },
  });
  return { cancelledCount: result.count };
}

// --- resumePausedJobsForShop --------------------------------------------
//
// When the daily budget rolls over for a shop (next-day-first-write
// path in tagging-cost.resetBudgetTripwiresForNewDay), any rows
// previously flipped to BUDGET_PAUSED are eligible to run again.
// Flips them back to QUEUED. Does NOT clear errorClass/errorMessage so
// the operator can see why they were paused.
export async function resumePausedJobsForShop(
  shopDomain: string,
): Promise<{ resumedCount: number }> {
  const result = await prisma.taggingJob.updateMany({
    where: {
      shopDomain,
      kind: { in: ["SINGLE_PRODUCT", "MANUAL_RETAG"] },
      status: "BUDGET_PAUSED",
    },
    data: { status: "QUEUED" },
  });
  return { resumedCount: result.count };
}

// Re-export the shared kind type so callers don't need to round-trip
// through @prisma/client when they're already importing from this
// module.
export type { TaggingJob, TaggingJobKind, TaggingJobStatus };
