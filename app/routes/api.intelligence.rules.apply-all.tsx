// Apply all enabled rules across all products in the shop (006a §5.8).
//
// Purely additive (Decision 2): rules write only to axes that don't yet
// have a value. Locked HUMAN tags untouched. Same job pattern as 005a.

import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  checkRateLimit,
  completeJob,
  failJob,
  incrementJobProgress,
  setJobTotal,
  startJob,
} from "../lib/catalog/jobs.server";
import { applyRules } from "../lib/catalog/rule-engine.server";
import { STARTER_AXES, type StoreMode } from "../lib/catalog/store-axes";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const { session } = await authenticate.admin(request);

  const check = checkRateLimit(session.shop, "apply_rules");
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
  startJob(session.shop, "apply_rules", jobId);

  void run(session.shop, jobId);

  return Response.json({ jobId });
};

async function run(shopDomain: string, jobId: string): Promise<void> {
  try {
    const config = await prisma.merchantConfig.findUnique({
      where: { shop: shopDomain },
      select: { storeMode: true },
    });
    const mode: StoreMode =
      ((config?.storeMode ?? null) as StoreMode | null) ?? "GENERAL";

    // Load enabled rules once; pass into applyRules so we don't requery
    // for every product.
    const rules = await prisma.taggingRule.findMany({
      where: { shopDomain, enabled: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    const products = await prisma.product.findMany({
      where: { shopDomain, deletedAt: null },
      include: { tags: true },
    });
    setJobTotal(jobId, products.length);

    for (const product of products) {
      try {
        await applyRules({
          shopDomain,
          product,
          axesNeeded: STARTER_AXES[mode],
          rules,
        });
        incrementJobProgress(jobId, 1, 0);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[apply-rules] ${shopDomain} product ${product.id} failed`, err);
        incrementJobProgress(jobId, 1, 1);
      }
    }
    completeJob(jobId);
  } catch (err) {
    failJob(jobId, err);
  }
}

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
