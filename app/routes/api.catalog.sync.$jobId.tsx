// Phase 1 (PR-A): per-job status endpoint, now reading from DB.
//
// Wire shape preserved from the legacy in-memory version so
// useSyncJobProgress and the dashboard components don't have to change
// their type contracts. Status enum values are lowercased here at the
// API boundary because the React UI was already coded against
// "queued" | "running" | "succeeded" | "failed" — no reason to churn
// every consumer for the case difference.
//
// "progress" surfaced is processedProducts (the dominant phase). The
// dashboard's percentage bar is products-centric; collections and
// metaobjects are too small to be worth a separate tracker. Phase 8
// dashboard will read the full structured view directly from
// CatalogSyncJob.

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getJobById } from "../lib/catalog/sync-jobs.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;
  if (!jobId) {
    return Response.json({ error: "missing_job_id" }, { status: 400 });
  }

  const job = await getJobById(jobId);
  if (!job) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Cross-shop isolation: 404 rather than 403 to avoid leaking the
  // existence of jobs across tenants. Same posture as the legacy route.
  if (job.shopDomain !== session.shop) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({
    jobId: job.id,
    kind: job.kind, // INITIAL | MANUAL_RESYNC | DELTA — uppercase
    status: lowerStatus(job.status),
    progress: job.processedProducts,
    total: job.totalProducts ?? 0,
    failed: job.failedProducts,
    error: job.errorMessage ?? null,
    startedAt: (job.startedAt ?? job.enqueuedAt).toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  });
};

function lowerStatus(
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED",
): "queued" | "running" | "succeeded" | "failed" {
  switch (status) {
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "running";
    case "SUCCEEDED":
      return "succeeded";
    // CANCELLED is surfaced as "failed" to the legacy UI — the v1
    // dashboard doesn't have a distinct cancelled treatment, and a
    // cancelled job is effectively "didn't complete" from the
    // merchant's perspective. Phase 8 redesign will tease them apart.
    case "FAILED":
    case "CANCELLED":
      return "failed";
  }
}
