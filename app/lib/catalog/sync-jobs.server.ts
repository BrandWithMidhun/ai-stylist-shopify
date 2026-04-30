// Phase 1 (PR-A): DB-backed CatalogSyncJob primitives.
//
// Replaces the in-memory `kind: "sync"` slot in jobs.server.ts. The
// other in-memory kinds (batch_tag, apply_rules, rematch_taxonomy)
// stay where they are — Phase 2 territory.
//
// Design:
//   - Plain functions, no class. Each function takes shopDomain or
//     jobId explicitly so callers can compose.
//   - claimNextJob uses the canonical Postgres queue claim pattern
//     (FOR UPDATE SKIP LOCKED) so multiple workers can compete safely.
//   - The partial unique index on (shopDomain) WHERE status='RUNNING'
//     is the DB-level safety net; the claim's NOT EXISTS subquery is
//     the application-level enforcement.
//   - cancelDeltaJobsForShop runs inside createManualResyncJob's
//     transaction so a manual resync atomically supersedes pending
//     DELTAs (refinement #1).
//   - sweepStuckJobs resets RUNNING jobs with stale heartbeatAt back
//     to QUEUED (NOT FAILED). Resume from cursor is safe because
//     every batch commits (cursor + upserts) atomically (refinement #3).
//
// All raw SQL is parameterized — no string concatenation, no shop
// names in query bodies.

import type {
  CatalogSyncJob,
  CatalogSyncJobFailure,
  CatalogSyncJobKind,
  CatalogSyncJobPhase,
  CatalogSyncJobStatus,
  Prisma,
} from "@prisma/client";
import prisma from "../../db.server";

// Heartbeat timeout: how long a RUNNING job can go without writing
// heartbeatAt before sweepStuckJobs resets it. Default 5 minutes for
// Phase 1 — Phase 8 monitoring tunes this to 60-90s. Configurable via
// env so we can adjust without a deploy.
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000;

export function getHeartbeatTimeoutMs(): number {
  // eslint-disable-next-line no-undef
  const raw = process.env.KNOWLEDGE_WORKER_HEARTBEAT_TIMEOUT_MS;
  if (!raw) return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  return parsed;
}

// --- createJob -----------------------------------------------------------

export async function createJob(params: {
  shopDomain: string;
  kind: CatalogSyncJobKind;
}): Promise<CatalogSyncJob> {
  // For MANUAL_RESYNC, atomically cancel any QUEUED/RUNNING DELTAs for
  // the same shop so the resync doesn't have to fight a delta later.
  if (params.kind === "MANUAL_RESYNC") {
    return prisma.$transaction(async (tx) => {
      await cancelDeltaJobsForShop(params.shopDomain, tx);
      return tx.catalogSyncJob.create({
        data: {
          shopDomain: params.shopDomain,
          kind: params.kind,
          status: "QUEUED",
        },
      });
    });
  }
  return prisma.catalogSyncJob.create({
    data: {
      shopDomain: params.shopDomain,
      kind: params.kind,
      status: "QUEUED",
    },
  });
}

// --- claimNextJob --------------------------------------------------------

// Worker side: returns the next job to run, atomically marking it
// RUNNING and recording startedAt + heartbeatAt. Returns null if no
// claimable job exists.
//
// The CTE selects the oldest QUEUED job for which no other job is
// already RUNNING for the same shop. FOR UPDATE OF cj SKIP LOCKED
// makes the row claim safe across concurrent workers — losers move on
// to the next candidate without blocking.
//
// Phase 2 boundary (addition A in PR-B execution prompt): the explicit
// kind IN (...) filter restricts this claim to the kinds the catalog-
// sync worker handles. Today the CatalogSyncJobKind enum is exactly
// {INITIAL, MANUAL_RESYNC, DELTA} so the filter is technically
// redundant, but the in-memory jobs.server.ts file still hosts a
// `batch_tag` kind for Phase 2's tagging engine. When Phase 2
// migrates batch_tag to a DB-backed CatalogSyncJob row, that new enum
// value WILL be added and a separate Phase 2 worker (or a
// kind-dispatched extension of this worker) will claim it. The filter
// here ensures this worker keeps ignoring kinds it doesn't own —
// future maintainers, please don't drop the filter.
export async function claimNextJob(): Promise<CatalogSyncJob | null> {
  const rows = await prisma.$queryRaw<CatalogSyncJob[]>`
    WITH cte AS (
      SELECT cj.id
      FROM "CatalogSyncJob" cj
      WHERE cj.status = 'QUEUED'
        AND cj.kind IN ('INITIAL', 'MANUAL_RESYNC', 'DELTA')
        AND NOT EXISTS (
          SELECT 1 FROM "CatalogSyncJob" cj2
          WHERE cj2."shopDomain" = cj."shopDomain"
            AND cj2.status = 'RUNNING'
        )
      ORDER BY cj."enqueuedAt"
      FOR UPDATE OF cj SKIP LOCKED
      LIMIT 1
    )
    UPDATE "CatalogSyncJob" cj
    SET status = 'RUNNING',
        "startedAt" = COALESCE(cj."startedAt", NOW()),
        "heartbeatAt" = NOW(),
        "updatedAt" = NOW()
    FROM cte
    WHERE cj.id = cte.id
    RETURNING cj.*
  `;
  return rows[0] ?? null;
}

// --- heartbeat / progress / cursor / phase -------------------------------

export async function heartbeat(jobId: string): Promise<void> {
  await prisma.catalogSyncJob.update({
    where: { id: jobId },
    data: { heartbeatAt: new Date() },
  });
}

export type ProgressUpdate = {
  processedProducts?: number;
  processedCollections?: number;
  processedMetaobjects?: number;
  totalProducts?: number;
  totalCollections?: number;
  totalMetaobjects?: number;
  failedProducts?: number;
  phase?: CatalogSyncJobPhase;
};

export async function updateProgress(
  jobId: string,
  update: ProgressUpdate,
): Promise<void> {
  await prisma.catalogSyncJob.update({
    where: { id: jobId },
    data: {
      ...update,
      heartbeatAt: new Date(),
    },
  });
}

export type CursorUpdate = {
  productsCursor?: string | null;
  metaobjectsCursor?: string | null;
  collectionsCursor?: string | null;
};

export async function saveCursor(
  jobId: string,
  cursors: CursorUpdate,
  // Optional tx so callers can commit the cursor in the same tx as
  // the upserts it points past — exactly-once semantics on resume.
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  // PR-C C.3: also update the matching *CursorAt timestamp so we can
  // measure how stale a saved cursor is when the worker resumes from
  // it. One write per save; atomic with the cursor write.
  const now = new Date();
  const data: Prisma.CatalogSyncJobUpdateInput = {
    ...cursors,
    heartbeatAt: now,
  };
  if ("productsCursor" in cursors) data.productsCursorAt = now;
  if ("metaobjectsCursor" in cursors) data.metaobjectsCursorAt = now;
  if ("collectionsCursor" in cursors) data.collectionsCursorAt = now;
  await tx.catalogSyncJob.update({
    where: { id: jobId },
    data,
  });
}

// --- finishJob -----------------------------------------------------------

export async function finishJob(
  jobId: string,
  outcome: {
    status: Extract<CatalogSyncJobStatus, "SUCCEEDED" | "FAILED" | "CANCELLED">;
    summary?: Prisma.InputJsonValue;
    errorMessage?: string;
  },
): Promise<void> {
  await prisma.catalogSyncJob.update({
    where: { id: jobId },
    data: {
      status: outcome.status,
      finishedAt: new Date(),
      summary: outcome.summary,
      errorMessage: outcome.errorMessage,
    },
  });
}

// --- logFailure ----------------------------------------------------------

export async function logFailure(params: {
  jobId: string;
  shopDomain: string;
  kind: string;
  shopifyGid?: string | null;
  message: string;
  attempt?: number;
}): Promise<CatalogSyncJobFailure> {
  // Truncate message to keep failure rows small even if Shopify or our
  // upstream throws a giant error.
  const truncated =
    params.message.length > 1024
      ? params.message.slice(0, 1024) + "…"
      : params.message;

  // Two writes inline; not wrapping in a transaction because failure
  // logging being slightly racy (failure row written, errorCount bump
  // missed on crash) is much better than holding a tx for every error.
  const [, failure] = await Promise.all([
    prisma.catalogSyncJob.update({
      where: { id: params.jobId },
      data: { errorCount: { increment: 1 } },
    }),
    prisma.catalogSyncJobFailure.create({
      data: {
        jobId: params.jobId,
        shopDomain: params.shopDomain,
        kind: params.kind,
        shopifyGid: params.shopifyGid ?? null,
        message: truncated,
        attempt: params.attempt ?? 1,
      },
    }),
  ]);
  return failure;
}

// --- cancelDeltaJobsForShop ---------------------------------------------

// Refinement #1: when MANUAL_RESYNC is enqueued OR starts, cancel ALL
// existing DELTA jobs for that shop in QUEUED state, in addition to
// preempting any RUNNING one. Returns the count of cancelled jobs.
export async function cancelDeltaJobsForShop(
  shopDomain: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ cancelledCount: number }> {
  const result = await tx.catalogSyncJob.updateMany({
    where: {
      shopDomain,
      kind: "DELTA",
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "CANCELLED",
      finishedAt: new Date(),
      errorMessage: "Cancelled by manual resync",
    },
  });
  return { cancelledCount: result.count };
}

// --- sweepStuckJobs ------------------------------------------------------

// Refinement #3: at worker boot (or on a periodic tick), reset RUNNING
// jobs with stale heartbeatAt back to QUEUED so the next claim resumes
// from cursor. Do NOT mark FAILED — the work is idempotent and the
// merchant shouldn't have to re-click. Returns the IDs that were swept.
export async function sweepStuckJobs(
  timeoutMs: number = getHeartbeatTimeoutMs(),
): Promise<{ resumedJobIds: string[] }> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const stuck = await prisma.catalogSyncJob.findMany({
    where: {
      status: "RUNNING",
      OR: [{ heartbeatAt: null }, { heartbeatAt: { lt: cutoff } }],
    },
    select: { id: true },
  });
  if (stuck.length === 0) return { resumedJobIds: [] };

  const ids = stuck.map((s) => s.id);
  // Reset in a single update. The partial unique index doesn't fire
  // because we're moving away from RUNNING — no constraint conflict.
  // startedAt is preserved for telemetry.
  await prisma.catalogSyncJob.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "QUEUED",
      heartbeatAt: null,
    },
  });
  return { resumedJobIds: ids };
}

// --- releaseJobToQueue ---------------------------------------------------

// PR-B: graceful-shutdown path. SIGTERM during a RUNNING job leaves the
// row at status='RUNNING' with a fresh heartbeat; without explicit
// release the next worker boot can't claim it (the at-most-one-RUNNING
// rule blocks the claim) until heartbeat goes stale (5 min default).
// Calling releaseJobToQueue on a clean shutdown skips that delay.
//
// Behavior:
//   - RUNNING → QUEUED, heartbeatAt cleared, cursors & progress untouched
//   - QUEUED  → no-op (idempotent)
//   - SUCCEEDED/FAILED/CANCELLED → throws (we don't resurrect terminal jobs)
export async function releaseJobToQueue(
  jobId: string,
  options?: { tx?: Prisma.TransactionClient },
): Promise<{ released: boolean }> {
  const tx = options?.tx ?? prisma;
  const job = await tx.catalogSyncJob.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  if (!job) {
    throw new Error(`releaseJobToQueue: job ${jobId} not found`);
  }
  if (job.status === "QUEUED") {
    return { released: false };
  }
  if (job.status !== "RUNNING") {
    throw new Error(
      `releaseJobToQueue: job ${jobId} is ${job.status}, refusing to resurrect`,
    );
  }
  await tx.catalogSyncJob.update({
    where: { id: jobId },
    data: {
      status: "QUEUED",
      heartbeatAt: null,
    },
  });
  return { released: true };
}

// --- read-side helpers ---------------------------------------------------

// What loader.server.ts needs to branch the dashboard mode. Returns
// the most-recently-enqueued non-terminal job for a shop, or the most
// recent succeeded job for the lastFullSyncAt surrogate.
export async function getActiveJobForShop(
  shopDomain: string,
): Promise<CatalogSyncJob | null> {
  return prisma.catalogSyncJob.findFirst({
    where: {
      shopDomain,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { enqueuedAt: "desc" },
  });
}

export async function getJobById(jobId: string): Promise<CatalogSyncJob | null> {
  return prisma.catalogSyncJob.findUnique({ where: { id: jobId } });
}

// Most recent finished job for surfacing "last sync" and summary in
// the future Phase 8 dashboard.
export async function getMostRecentFinishedJob(
  shopDomain: string,
): Promise<CatalogSyncJob | null> {
  return prisma.catalogSyncJob.findFirst({
    where: {
      shopDomain,
      status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
    },
    orderBy: { finishedAt: "desc" },
  });
}

// Failures for a specific job, newest first. Phase 8 reads this for
// the "see N failures" expander on the runs panel.
export async function listJobFailures(
  jobId: string,
  limit = 100,
): Promise<CatalogSyncJobFailure[]> {
  return prisma.catalogSyncJobFailure.findMany({
    where: { jobId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}
