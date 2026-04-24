// Unified upsert path for Product + ProductVariant.
// Used by:
//   - the full-catalog sync job (GraphQL payloads)
//   - the products/create and products/update webhooks (REST-shape payloads)
// Both sources are normalized into NormalizedProduct then written the same way.
//
// Contract: idempotent. Running the same payload twice results in the same
// DB state. Stale variants (present in DB but absent from the incoming
// payload) are hard-deleted (per decision 6 in the execution plan).

import { Prisma } from "@prisma/client";
import prisma from "../../db.server";
import type { GqlProduct } from "./graphql.server";

// TODO(006): make the LOW_STOCK threshold configurable per-merchant.
const LOW_STOCK_THRESHOLD = 5;

export type NormalizedVariant = {
  shopifyGid: string;
  title: string;
  sku: string | null;
  price: string; // stringified decimal
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryItemId: string | null;
  availableForSale: boolean;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  imageUrl: string | null;
};

export type NormalizedProduct = {
  shopifyGid: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  productType: string | null;
  vendor: string | null;
  status: string;
  featuredImageUrl: string | null;
  imageUrls: string[];
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  shopifyTags: string[];
  totalInventory: number | null;
  shopifyCreatedAt: Date;
  shopifyUpdatedAt: Date;
  variants: NormalizedVariant[];
};

export function deriveInventoryStatus(total: number | null): string {
  if (total === null) return "IN_STOCK"; // untracked inventory — assume available
  if (total <= 0) return "OUT_OF_STOCK";
  if (total <= LOW_STOCK_THRESHOLD) return "LOW_STOCK";
  return "IN_STOCK";
}

// --- Normalizers ---------------------------------------------------------

export function normalizeFromGraphQL(p: GqlProduct): NormalizedProduct {
  return {
    shopifyGid: p.id,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    productType: p.productType,
    vendor: p.vendor,
    status: p.status,
    featuredImageUrl: p.featuredImage?.url ?? null,
    imageUrls: p.images.nodes.map((n) => n.url),
    priceMin: p.priceRangeV2?.minVariantPrice.amount ?? null,
    priceMax: p.priceRangeV2?.maxVariantPrice.amount ?? null,
    currency: p.priceRangeV2?.minVariantPrice.currencyCode ?? null,
    shopifyTags: p.tags,
    totalInventory: p.totalInventory,
    shopifyCreatedAt: new Date(p.createdAt),
    shopifyUpdatedAt: new Date(p.updatedAt),
    variants: p.variants.nodes.map((v) => ({
      shopifyGid: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      inventoryQuantity: v.inventoryQuantity,
      inventoryItemId: extractNumericId(v.inventoryItem?.id ?? null),
      availableForSale: v.availableForSale,
      option1: v.selectedOptions[0]?.value ?? null,
      option2: v.selectedOptions[1]?.value ?? null,
      option3: v.selectedOptions[2]?.value ?? null,
      imageUrl: v.image?.url ?? null,
    })),
  };
}

// Webhook payload shape (products/create, products/update).
// Shopify delivers webhooks in the legacy REST shape even for GraphQL apps.
export type WebhookProductPayload = {
  id: number | string;
  handle: string;
  title: string;
  body_html: string | null;
  product_type: string | null;
  vendor: string | null;
  status: string;
  tags: string | string[];
  created_at: string;
  updated_at: string;
  image?: { src: string } | null;
  images?: Array<{ src: string }>;
  variants?: Array<{
    id: number | string;
    title: string;
    sku: string | null;
    price: string;
    compare_at_price: string | null;
    inventory_quantity: number | null;
    inventory_item_id: number | string | null;
    option1: string | null;
    option2: string | null;
    option3: string | null;
    available?: boolean;
    image_id?: number | null;
  }>;
};

export function normalizeFromWebhook(
  p: WebhookProductPayload,
): NormalizedProduct {
  const variants = p.variants ?? [];
  const inventoryQuantities = variants
    .map((v) => v.inventory_quantity)
    .filter((q): q is number => typeof q === "number");
  const totalInventory = inventoryQuantities.length
    ? inventoryQuantities.reduce((a, b) => a + b, 0)
    : null;
  const prices = variants.map((v) => parseFloat(v.price)).filter((n) => !Number.isNaN(n));
  const priceMin = prices.length ? Math.min(...prices).toString() : null;
  const priceMax = prices.length ? Math.max(...prices).toString() : null;
  const imageUrls = (p.images ?? []).map((i) => i.src).slice(0, 20);
  const shopifyTags = Array.isArray(p.tags)
    ? p.tags
    : p.tags
      ? p.tags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

  return {
    shopifyGid: toProductGid(p.id),
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.body_html,
    productType: p.product_type,
    vendor: p.vendor,
    status: (p.status ?? "ACTIVE").toUpperCase(),
    featuredImageUrl: p.image?.src ?? imageUrls[0] ?? null,
    imageUrls,
    priceMin,
    priceMax,
    currency: null, // webhook payload does not include currency
    shopifyTags,
    totalInventory,
    shopifyCreatedAt: new Date(p.created_at),
    shopifyUpdatedAt: new Date(p.updated_at),
    variants: variants.map((v) => ({
      shopifyGid: toVariantGid(v.id),
      title: v.title,
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      inventoryQuantity: v.inventory_quantity ?? null,
      inventoryItemId:
        v.inventory_item_id !== null && v.inventory_item_id !== undefined
          ? String(v.inventory_item_id)
          : null,
      availableForSale: v.available ?? true,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      imageUrl: null, // webhook image_id → URL resolution deferred; not needed for tagging
    })),
  };
}

// --- Write path ----------------------------------------------------------

export type UpsertResult = {
  productId: string;
  created: boolean;
};

export async function upsertNormalizedProduct(
  shopDomain: string,
  n: NormalizedProduct,
  tx: Prisma.TransactionClient = prisma,
): Promise<UpsertResult> {
  const inventoryStatus = deriveInventoryStatus(n.totalInventory);

  const existing = await tx.product.findUnique({
    where: {
      shopDomain_shopifyId: {
        shopDomain,
        shopifyId: n.shopifyGid,
      },
    },
    select: { id: true },
  });

  const product = await tx.product.upsert({
    where: {
      shopDomain_shopifyId: {
        shopDomain,
        shopifyId: n.shopifyGid,
      },
    },
    create: {
      shopDomain,
      shopifyId: n.shopifyGid,
      handle: n.handle,
      title: n.title,
      descriptionHtml: n.descriptionHtml,
      productType: n.productType,
      vendor: n.vendor,
      status: n.status,
      featuredImageUrl: n.featuredImageUrl,
      imageUrls: n.imageUrls,
      priceMin: n.priceMin,
      priceMax: n.priceMax,
      currency: n.currency,
      shopifyTags: n.shopifyTags,
      totalInventory: n.totalInventory,
      inventoryStatus,
      shopifyCreatedAt: n.shopifyCreatedAt,
      shopifyUpdatedAt: n.shopifyUpdatedAt,
      syncedAt: new Date(),
      deletedAt: null,
    },
    update: {
      handle: n.handle,
      title: n.title,
      descriptionHtml: n.descriptionHtml,
      productType: n.productType,
      vendor: n.vendor,
      status: n.status,
      featuredImageUrl: n.featuredImageUrl,
      imageUrls: n.imageUrls,
      priceMin: n.priceMin,
      priceMax: n.priceMax,
      currency: n.currency,
      shopifyTags: n.shopifyTags,
      totalInventory: n.totalInventory,
      inventoryStatus,
      shopifyCreatedAt: n.shopifyCreatedAt,
      shopifyUpdatedAt: n.shopifyUpdatedAt,
      syncedAt: new Date(),
      deletedAt: null, // un-soft-delete if product returned
    },
  });

  const incomingVariantIds = new Set(n.variants.map((v) => v.shopifyGid));

  await tx.productVariant.deleteMany({
    where: {
      productId: product.id,
      shopifyId: { notIn: Array.from(incomingVariantIds) },
    },
  });

  for (const v of n.variants) {
    await tx.productVariant.upsert({
      where: {
        productId_shopifyId: {
          productId: product.id,
          shopifyId: v.shopifyGid,
        },
      },
      create: {
        productId: product.id,
        shopifyId: v.shopifyGid,
        title: v.title,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        inventoryQuantity: v.inventoryQuantity,
        inventoryItemId: v.inventoryItemId,
        availableForSale: v.availableForSale,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        imageUrl: v.imageUrl,
      },
      update: {
        title: v.title,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        inventoryQuantity: v.inventoryQuantity,
        inventoryItemId: v.inventoryItemId,
        availableForSale: v.availableForSale,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        imageUrl: v.imageUrl,
      },
    });
  }

  return { productId: product.id, created: !existing };
}

// --- Helpers --------------------------------------------------------------

function toProductGid(id: number | string): string {
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/Product/${s}`;
}

function toVariantGid(id: number | string): string {
  const s = String(id);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/ProductVariant/${s}`;
}

function extractNumericId(gid: string | null): string | null {
  if (!gid) return null;
  const parts = gid.split("/");
  return parts[parts.length - 1] || null;
}
