import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  normalizeFromWebhook,
  upsertNormalizedProduct,
  type WebhookProductPayload,
} from "../lib/catalog/upsert.server";
import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";

// PR-C C.2.1: dual-write pattern — restore the legacy
// upsertNormalizedProduct call alongside the C.2 enqueueDeltaForShop
// call. Addition 2 surfaced that the worker's upsertProductKnowledge
// only writes knowledge-record fields (descriptionText, hash, sync
// timestamps); the legacy product columns (title, productType, vendor,
// shopifyTags, featuredImageUrl, imageUrls, priceMin/Max, currency,
// totalInventory, inventoryStatus, variants) had no remaining writer
// once C.2 dropped the legacy call. Two writes per webhook is fine —
// legacy upsert is fast (no GraphQL fetch, payload-only); DELTA enqueue
// is async via worker (fan-out for metafields/collections/hash). See
// "Known structural debt — two-writer pattern" in PR-C report.

type ProductPayload = WebhookProductPayload & {
  id?: number | string;
  updated_at?: string;
};

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

  let legacyUpsertOk = false;
  try {
    const normalized = normalizeFromWebhook(body);
    await prisma.$transaction(async (tx) => {
      await upsertNormalizedProduct(shop, normalized, tx);
    });
    legacyUpsertOk = true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "products_legacy_upsert_failed",
        topic,
        shop,
        webhookId,
        resourceId: resourceGid,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  const enqueue = await enqueueDeltaForShop(shop, { topic, webhookId, resourceGid });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "products_webhook_dual_write",
      topic,
      shop,
      webhookId,
      resourceId: resourceGid,
      legacyUpsertOk,
      deltaEnqueued: true,
      deduped: enqueue.deduped,
      jobId: enqueue.jobId,
      durationMs: Date.now() - start,
    }),
  );

  return new Response();
};
