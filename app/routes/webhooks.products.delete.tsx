import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";

type ProductDeletePayload = { id?: number | string; updated_at?: string };

// Spec 4.3:
//   - soft-delete Product (set deletedAt)
//   - cascade-delete ProductTags
//   - hard-delete ProductVariants (per execution decision 7)
//   - keep ProductTagAudit intact
//
// PR-C C.2: after the soft-delete, also enqueue a DELTA so the worker
// reconciles against Shopify's authoritative view (e.g. product was
// restored before the worker ran, or membership/metafield cleanup left
// dangling state). Both calls happen in the same handler — the delete
// is fast-path correctness, the DELTA is reconciliation.
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

  const body = payload as ProductDeletePayload;
  if (body.id === undefined || body.id === null) {
    // eslint-disable-next-line no-console
    console.log(`[webhook] ${topic} for ${shop} missing id — ignoring`);
    return new Response();
  }

  const shopifyGid = `gid://shopify/Product/${String(body.id)}`;
  const payloadUpdatedAt =
    typeof body.updated_at === "string" ? new Date(body.updated_at) : null;

  const product = await prisma.product.findUnique({
    where: {
      shopDomain_shopifyId: { shopDomain: shop, shopifyId: shopifyGid },
    },
    select: { id: true, shopifyUpdatedAt: true, deletedAt: true },
  });

  if (!product) {
    // eslint-disable-next-line no-console
    console.log(
      `[webhook] ${topic} for ${shop} product ${shopifyGid} not in local DB — ignoring`,
    );
    return new Response();
  }

  if (
    payloadUpdatedAt &&
    product.shopifyUpdatedAt >= payloadUpdatedAt &&
    product.deletedAt
  ) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        event: "stale_webhook_skipped",
        topic,
        shop,
        webhookId,
        resourceId: shopifyGid,
        existingShopifyUpdatedAt: product.shopifyUpdatedAt.toISOString(),
        payloadUpdatedAt: payloadUpdatedAt.toISOString(),
      }),
    );
    return new Response();
  }

  await prisma.$transaction([
    prisma.productTag.deleteMany({ where: { productId: product.id } }),
    prisma.productVariant.deleteMany({ where: { productId: product.id } }),
    prisma.product.update({
      where: { id: product.id },
      data: { deletedAt: new Date() },
    }),
  ]);

  await enqueueDeltaForShop(shop, { topic, webhookId, resourceGid: shopifyGid });
  return new Response();
};
