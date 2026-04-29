// Phase 1 (PR-C): shared helper for webhook handlers to enqueue DELTA
// catalog sync jobs.
//
// C.1 ships this as a STUB — every handler can import + call it, but the
// real createJob + dedup logic lands in C.2. Keeping the import surface
// stable across C.1 → C.2 lets C.1 ship with skeleton handlers that
// already log structurally without dual-rewriting their imports later.
//
// C.2 will replace the stub body with:
//   1. Look for an existing QUEUED DELTA for this shop. If one exists,
//      return { deduped: true, jobId: existingJob.id } — no new row.
//      (Q3 decision: application-level dedup, not a partial unique index.)
//   2. Otherwise call createJob({ shopDomain: shop, kind: 'DELTA' }).
//      Return { deduped: false, jobId: newJob.id }.
//   3. Log structurally with topic, webhookId, resourceGid, outcome.
//
// Stub behavior: log the call, return { deduped: false }. No DB write.
// Importers can compose against the final shape today.

export type EnqueueDeltaReason = {
  topic: string;
  webhookId: string;
  resourceGid?: string | null;
};

export type EnqueueDeltaResult = {
  jobId?: string;
  deduped: boolean;
};

export async function enqueueDeltaForShop(
  shopDomain: string,
  reason: EnqueueDeltaReason,
): Promise<EnqueueDeltaResult> {
  // C.1 stub. Real implementation in C.2.
  // eslint-disable-next-line no-console
  console.log(
    `[webhook:enqueue-delta:stub] shop=${shopDomain} topic=${reason.topic} webhookId=${reason.webhookId} resourceGid=${reason.resourceGid ?? "null"}`,
  );
  return { deduped: false };
}
