import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";

// PR-C → C.2.1 → C.5: see webhooks.products.create.tsx header for the
// full evolution. Thin handler post-C.5 — worker is the sole writer.

type ProductPayload = { id?: number | string; updated_at?: string };

export const action = async ({ request }: ActionFunctionArgs) => {
  const start = Date.now();
  const { shop, topic, payload } = await authenticate.webhook(request);
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? "unknown";

  const config = await prisma.merchantConfig.findUnique({
    where: { shop },
    select: { lastFullSyncAt: true },
  });
  if (!config?.lastFullSyncAt) {
    // eslint-disable-next-line no-console
    console.log(
      `[webhook] ignoring ${topic} for ${shop} — no initial sync yet`,
    );
    return new Response();
  }

  const body = payload as ProductPayload;
  const resourceGid =
    body.id !== undefined && body.id !== null
      ? `gid://shopify/Product/${String(body.id)}`
      : null;
  const payloadUpdatedAt =
    typeof body.updated_at === "string" ? new Date(body.updated_at) : null;

  if (resourceGid && payloadUpdatedAt) {
    const existing = await prisma.product.findUnique({
      where: { shopDomain_shopifyId: { shopDomain: shop, shopifyId: resourceGid } },
      select: { shopifyUpdatedAt: true },
    });
    if (existing && existing.shopifyUpdatedAt >= payloadUpdatedAt) {
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "stale_webhook_skipped",
          topic,
          shop,
          webhookId,
          resourceId: resourceGid,
          existingShopifyUpdatedAt: existing.shopifyUpdatedAt.toISOString(),
          payloadUpdatedAt: payloadUpdatedAt.toISOString(),
        }),
      );
      return new Response();
    }
  }

  const enqueue = await enqueueDeltaForShop(shop, { topic, webhookId, resourceGid });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "products_webhook_enqueued",
      topic,
      shop,
      webhookId,
      resourceId: resourceGid,
      deduped: enqueue.deduped,
      jobId: enqueue.jobId,
      durationMs: Date.now() - start,
    }),
  );

  return new Response();
};
