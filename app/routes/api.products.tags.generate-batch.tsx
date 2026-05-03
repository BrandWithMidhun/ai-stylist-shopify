import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  checkRateLimit,
  completeJob,
  setJobTotal,
  startJob,
} from "../lib/catalog/jobs.server";
import { enqueueTaggingForProduct } from "../lib/catalog/enqueue-tagging.server";

// PR-2.1: this route used to spawn an in-memory pLimit loop that
// called ai-tagger directly per product. That path is DEPRECATED.
// We now enqueue one TaggingJob row per product into the DB-backed
// queue and let the worker drain them. The in-memory job created via
// startJob/setJobTotal/completeJob is preserved so the existing
// caller's response shape stays the same; we mark the in-memory job
// completed immediately because the real work moved to the queue.
//
// Cleanup of this route in 2.2 will replace the in-memory job
// surface with TaggingJob rollup queries.

const BodySchema = z.object({
  productIds: z.array(z.string()).optional(),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const check = checkRateLimit(session.shop, "batch_tag");
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

  let body: z.infer<typeof BodySchema> = {};
  try {
    const raw = (await request.json()) as unknown;
    body = BodySchema.parse(raw ?? {});
  } catch {
    // Empty body or JSON parse error — treat as "tag all pending".
    body = {};
  }

  const productIds = body.productIds
    ? await scopeToShop(session.shop, body.productIds)
    : await defaultPendingProducts(session.shop);

  if (productIds.length === 0) {
    return Response.json({
      ok: true,
      jobId: null,
      message: "No products to tag.",
    });
  }

  const inMemoryJobId = randomUUID();
  startJob(session.shop, "batch_tag", inMemoryJobId);
  setJobTotal(inMemoryJobId, productIds.length);

  // PR-2.1 routing: enqueue one TaggingJob per product. The DB
  // partial unique index dedups against any QUEUED row that already
  // exists. The worker drains independently. Errors here are
  // collected and reported in the response, but the per-product
  // enqueue is independent — one bad enqueue does not block the rest.
  const enqueueResults = await enqueuePerProduct(session.shop, productIds);
  // Mark the in-memory job done — the queue handles real progress.
  completeJob(inMemoryJobId);

  return Response.json({
    ok: true,
    jobId: inMemoryJobId,
    queuedCount: enqueueResults.queued,
    dedupedCount: enqueueResults.deduped,
    failedCount: enqueueResults.failed,
    taggingJobIds: enqueueResults.jobIds,
  });
};

async function enqueuePerProduct(
  shopDomain: string,
  productIds: string[],
): Promise<{
  queued: number;
  deduped: number;
  failed: number;
  jobIds: string[];
}> {
  let queued = 0;
  let deduped = 0;
  let failed = 0;
  const jobIds: string[] = [];
  for (const id of productIds) {
    try {
      const r = await enqueueTaggingForProduct({
        shopDomain,
        productId: id,
        triggerSource: "MANUAL",
        kind: "MANUAL_RETAG",
      });
      jobIds.push(r.jobId);
      if (r.deduped) deduped += 1;
      else queued += 1;
    } catch {
      failed += 1;
    }
  }
  return { queued, deduped, failed, jobIds };
}

async function scopeToShop(
  shopDomain: string,
  ids: string[],
): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, shopDomain, deletedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function defaultPendingProducts(shopDomain: string): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: {
      shopDomain,
      deletedAt: null,
      status: { not: "ARCHIVED" },
      tags: { none: {} },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export const loader = () => {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
};
