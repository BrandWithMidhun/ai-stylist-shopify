import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { deriveInventoryStatus } from "../lib/catalog/upsert.server";

type InventoryLevelsUpdatePayload = {
  inventory_item_id?: number | string;
  location_id?: number | string;
  available?: number | null;
  updated_at?: string;
};

// PR-C C.2: NO DELTA enqueue here (Q4 / option A). Inventory updates
// are extremely high-frequency — every order causes decrements — so
// queueing a DELTA per inventory webhook would flood the worker. Direct
// narrow upsert of just availability + totalInventory + inventoryStatus
// stays.
//
// Stale-write note: the schema does not currently track an inventory-
// side shopifyUpdatedAt on ProductVariant (Prisma's @updatedAt tracks
// our last write, not Shopify's). We log the payload's updated_at for
// forward characterization but do not skip on staleness here. If a
// real burst-of-stale-deliveries problem surfaces in production, a
// followup migration adds ProductVariant.inventoryUpdatedAt.

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

  const body = payload as InventoryLevelsUpdatePayload;
  if (body.inventory_item_id === undefined || body.inventory_item_id === null) {
    // eslint-disable-next-line no-console
    console.log(`[webhook] ${topic} for ${shop} missing inventory_item_id`);
    return new Response();
  }

  const inventoryItemId = String(body.inventory_item_id);
  const locationId =
    body.location_id !== undefined && body.location_id !== null
      ? String(body.location_id)
      : null;

  const variants = await prisma.productVariant.findMany({
    where: {
      inventoryItemId,
      product: { shopDomain: shop },
    },
    include: { product: { select: { id: true } } },
  });

  if (variants.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[webhook] ${topic} for ${shop} item ${inventoryItemId} not in local DB — ignoring`,
    );
    return new Response();
  }

  const available = typeof body.available === "number" ? body.available : null;

  await prisma.$transaction(async (tx) => {
    for (const v of variants) {
      await tx.productVariant.update({
        where: { id: v.id },
        data: { inventoryQuantity: available },
      });

      const remaining = await tx.productVariant.findMany({
        where: { productId: v.product.id },
        select: { inventoryQuantity: true },
      });
      const totals = remaining
        .map((r) => r.inventoryQuantity)
        .filter((n): n is number => typeof n === "number");
      const total = totals.length
        ? totals.reduce((a, b) => a + b, 0)
        : null;

      await tx.product.update({
        where: { id: v.product.id },
        data: {
          totalInventory: total,
          inventoryStatus: deriveInventoryStatus(total),
        },
      });
    }
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "inventory_update_processed",
      shop,
      topic,
      webhookId,
      inventoryItemId,
      locationId,
      available,
      payloadUpdatedAt: body.updated_at ?? null,
      variantCount: variants.length,
      durationMs: Date.now() - start,
    }),
  );
  return new Response();
};
