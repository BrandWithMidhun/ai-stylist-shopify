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

  const body = payload as InventoryLevelsUpdatePayload;
  if (body.inventory_item_id === undefined || body.inventory_item_id === null) {
    console.log(`[webhook] ${topic} for ${shop} missing inventory_item_id`);
    return new Response();
  }

  const inventoryItemId = String(body.inventory_item_id);

  const variants = await prisma.productVariant.findMany({
    where: {
      inventoryItemId,
      product: { shopDomain: shop },
    },
    include: { product: { select: { id: true } } },
  });

  if (variants.length === 0) {
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

  return new Response();
};
