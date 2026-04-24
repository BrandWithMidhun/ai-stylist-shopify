import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { computeTagStatus } from "../lib/catalog/tag-status";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) {
    return Response.json({ error: "missing_id" }, { status: 400 });
  }

  const product = await prisma.product.findFirst({
    where: { id, shopDomain: session.shop, deletedAt: null },
    include: { variants: true, tags: true },
  });

  if (!product) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  return Response.json({
    id: product.id,
    shopifyId: product.shopifyId,
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    productType: product.productType,
    vendor: product.vendor,
    status: product.status,
    featuredImageUrl: product.featuredImageUrl,
    imageUrls: product.imageUrls,
    priceMin: product.priceMin?.toString() ?? null,
    priceMax: product.priceMax?.toString() ?? null,
    currency: product.currency,
    shopifyTags: product.shopifyTags,
    totalInventory: product.totalInventory,
    inventoryStatus: product.inventoryStatus,
    shopifyCreatedAt: product.shopifyCreatedAt.toISOString(),
    shopifyUpdatedAt: product.shopifyUpdatedAt.toISOString(),
    syncedAt: product.syncedAt.toISOString(),
    variants: product.variants.map((v) => ({
      id: v.id,
      shopifyId: v.shopifyId,
      title: v.title,
      sku: v.sku,
      price: v.price.toString(),
      compareAtPrice: v.compareAtPrice?.toString() ?? null,
      inventoryQuantity: v.inventoryQuantity,
      inventoryItemId: v.inventoryItemId,
      availableForSale: v.availableForSale,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      imageUrl: v.imageUrl,
    })),
    tags: product.tags.map((t) => ({
      id: t.id,
      axis: t.axis,
      value: t.value,
      source: t.source,
      locked: t.locked,
      confidence: t.confidence,
      metadata: t.metadata,
    })),
    tagStatus: computeTagStatus(product.tags.map((t) => t.source)),
  });
};
