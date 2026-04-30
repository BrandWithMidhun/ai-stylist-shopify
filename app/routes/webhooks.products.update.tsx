import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";

type ProductUpdatePayload = { id?: number | string; updated_at?: string };

export const action = async ({ request }: ActionFunctionArgs) => {
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

  const body = payload as ProductUpdatePayload;
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

  await enqueueDeltaForShop(shop, { topic, webhookId, resourceGid });
  return new Response();
};
