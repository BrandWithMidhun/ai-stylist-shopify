import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import pLimit from "p-limit";
import { z } from "zod";
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
import { generateTagsForProductById } from "../lib/catalog/ai-tagger.server";

const BodySchema = z.object({
  productIds: z.array(z.string()).optional(),
});

const CONCURRENCY = 5;

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

  const jobId = randomUUID();
  startJob(session.shop, "batch_tag", jobId);
  setJobTotal(jobId, productIds.length);

  void runBatch(session.shop, jobId, productIds);

  return Response.json({ jobId });
};

async function runBatch(
  shopDomain: string,
  jobId: string,
  productIds: string[],
): Promise<void> {
  try {
    const limit = pLimit(CONCURRENCY);
    await Promise.all(
      productIds.map((id) =>
        limit(async () => {
          try {
            const result = await generateTagsForProductById({
              shopDomain,
              productId: id,
            });
            if (result.ok) {
              incrementJobProgress(jobId, 1, 0);
            } else {
              // eslint-disable-next-line no-console
              console.error(
                `[batch-tag] ${shopDomain} product ${id} failed: ${result.error}`,
              );
              incrementJobProgress(jobId, 1, 1);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`[batch-tag] ${shopDomain} product ${id} threw`, err);
            incrementJobProgress(jobId, 1, 1);
          }
        }),
      ),
    );
    completeJob(jobId);
  } catch (err) {
    failJob(jobId, err);
  }
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
