import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  normalizeFromWebhook,
  upsertNormalizedProduct,
  type WebhookProductPayload,
} from "../lib/catalog/upsert.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const config = await prisma.merchantConfig.findUnique({
    where: { shop },
    select: { lastFullSyncAt: true },
  });
  if (!config?.lastFullSyncAt) {
    console.log(
      `[webhook] ignoring ${topic} for ${shop} — no initial sync yet`,
    );
    return new Response();
  }

  const normalized = normalizeFromWebhook(payload as WebhookProductPayload);
  await prisma.$transaction(async (tx) => {
    await upsertNormalizedProduct(shop, normalized, tx);
  });

  return new Response();
};
