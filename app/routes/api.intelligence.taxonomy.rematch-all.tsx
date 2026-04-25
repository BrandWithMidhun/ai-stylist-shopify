// Re-match all products to the current taxonomy (006a §4.5).
//
// No confirm dialog (Decision 4 — pure logic, no API cost). No cooldown
// (Decision 5 — kind="rematch_taxonomy" is exempt). We still dedupe via
// the in-memory job registry so a stuck-button merchant can't fan out
// concurrent walks.

import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  checkRateLimit,
  completeJob,
  failJob,
  incrementJobProgress,
  setJobTotal,
  startJob,
} from "../lib/catalog/jobs.server";
import { rematchAllProducts } from "../lib/catalog/taxonomy-matcher.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);

  const check = checkRateLimit(session.shop, "rematch_taxonomy");
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
  startJob(session.shop, "rematch_taxonomy", jobId);

  void run(session.shop, jobId);

  return Response.json({ jobId });
};

async function run(shopDomain: string, jobId: string): Promise<void> {
  try {
    let totalSet = false;
    await rematchAllProducts(shopDomain, (_done, total) => {
      if (!totalSet) {
        setJobTotal(jobId, total);
        totalSet = true;
      }
      // onProgress fires once per product walked, so a delta of 1 keeps
      // job.progress in lockstep with `done`.
      incrementJobProgress(jobId, 1, 0);
    });
    completeJob(jobId);
  } catch (err) {
    failJob(jobId, err);
  }
}

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
