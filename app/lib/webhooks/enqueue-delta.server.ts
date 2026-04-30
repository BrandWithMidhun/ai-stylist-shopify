// Phase 1 (PR-C, C.2): real implementation of the shared helper webhook
// handlers call to enqueue a DELTA CatalogSyncJob.
//
// Q3 dedup pattern (option b): application-level. A handler that fires
// while another DELTA is already QUEUED for the shop returns the
// existing job id with deduped=true rather than inserting a second row.
// Trade-off vs a partial unique index: no migration, simpler error
// surface, the worker's `updated_at:>=` filter naturally collapses
// concurrent edits into a single fetch — so collapsing at the queue
// layer is correct.
//
// Race window note: between the SELECT-existing-QUEUED and the INSERT
// there is a microsecond gap where two concurrent webhook deliveries
// could both create a QUEUED row. Acceptable for PR-C — the worker
// fetches `updated_at:>= last successful sync` and gets every change
// regardless of how many DELTAs are queued. If Addition 3 ever shows
// real duplicates under burst we can promote this to a partial unique
// index (`(shopDomain) WHERE status='QUEUED' AND kind='DELTA'`).

import prisma from "../../db.server";

export type EnqueueDeltaReason = {
  topic: string;
  webhookId: string;
  resourceGid?: string | null;
};

export type EnqueueDeltaResult = {
  jobId: string;
  deduped: boolean;
};

export async function enqueueDeltaForShop(
  shopDomain: string,
  reason: EnqueueDeltaReason,
): Promise<EnqueueDeltaResult> {
  const start = Date.now();

  // Single atomic transaction so the SELECT and the INSERT see a
  // consistent snapshot. Postgres default isolation (READ COMMITTED) is
  // enough — we only need one writer to win the insert race within the
  // tx; the loser's repeated SELECT will see the new row.
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.catalogSyncJob.findFirst({
      where: {
        shopDomain,
        kind: "DELTA",
        status: "QUEUED",
      },
      select: { id: true },
      orderBy: { enqueuedAt: "asc" },
    });
    if (existing) {
      return { jobId: existing.id, deduped: true };
    }
    const created = await tx.catalogSyncJob.create({
      data: {
        shopDomain,
        kind: "DELTA",
        status: "QUEUED",
      },
      select: { id: true },
    });
    return { jobId: created.id, deduped: false };
  });

  const durationMs = Date.now() - start;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "delta_enqueue",
      shop: shopDomain,
      topic: reason.topic,
      webhookId: reason.webhookId,
      resourceId: reason.resourceGid ?? null,
      jobId: result.jobId,
      deduped: result.deduped,
      durationMs,
    }),
  );

  return result;
}
