import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";

// PR-C → C.2.1 → C.5 evolution:
//   C.2: webhook called legacy upsertNormalizedProduct + enqueueDelta.
//   C.2.1: removed legacy upsert, broke title/price propagation,
//          restored as a dual-write.
//   C.5: collapsed. Worker (upsertProductKnowledge) is the sole
//        authoritative writer post-DELTA-drain — it now writes both
//        knowledge fields and legacy Product columns (title, price,
//        inventory, variants) from its GraphQL fetch. Webhook handler
//        is thin: HMAC validate → stale-write check → DELTA enqueue
//        → 200. Latency from edit to DB row update extends from
//        ~150ms to ~5-30s; acceptable per HANDOFF dedup-design
//        rationale.

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
