import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";

type CollectionDeletePayload = { id?: number | string; updated_at?: string };

// PR-C C.2: hard-delete the Collection (cascades ProductCollection rows
// via the FK), then enqueue a DELTA so the worker reconciles the
// remaining product set against Shopify (e.g. smart-collection
// rebuild). Two calls in the same handler — the delete is fast-path
// correctness, the DELTA is reconciliation.
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

  const body = payload as CollectionDeletePayload;
  if (body.id === undefined || body.id === null) {
    // eslint-disable-next-line no-console
    console.log(`[webhook] ${topic} for ${shop} missing id — ignoring`);
    return new Response();
  }

  const shopifyGid = `gid://shopify/Collection/${String(body.id)}`;

  const collection = await prisma.collection.findUnique({
    where: { shopDomain_shopifyId: { shopDomain: shop, shopifyId: shopifyGid } },
    select: { id: true },
  });

  if (collection) {
    await prisma.collection.delete({ where: { id: collection.id } });
  }

  await enqueueDeltaForShop(shop, { topic, webhookId, resourceGid: shopifyGid });
  return new Response();
};
