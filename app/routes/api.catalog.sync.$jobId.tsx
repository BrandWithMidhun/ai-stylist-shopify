import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getJob } from "../lib/catalog/jobs.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;
  if (!jobId) {
    return Response.json({ error: "missing_job_id" }, { status: 400 });
  }

  const job = getJob(jobId);
  if (!job) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (job.shopDomain !== session.shop) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({
    jobId: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    total: job.total,
    failed: job.failed,
    error: job.error ?? null,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  });
};
