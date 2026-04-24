import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { checkRateLimit, startJob } from "../lib/catalog/jobs.server";
import { runCatalogSync } from "../lib/catalog/sync.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const check = checkRateLimit(session.shop, "sync");
  if (!check.ok) {
    return Response.json(
      {
        error: "rate_limited",
        reason: check.reason,
        retryAfterSeconds: check.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const jobId = randomUUID();
  startJob(session.shop, "sync", jobId);

  // Fire-and-forget. The function catches its own errors and routes them
  // into the in-memory job registry via failJob().
  void runCatalogSync({ shopDomain: session.shop, jobId });

  return Response.json({ jobId });
};

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
