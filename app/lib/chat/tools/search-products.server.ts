// search_products tool — Postgres-backed product discovery.
//
// SECURITY: shopDomain MUST come from the ToolExecutionContext (route-scoped
// installed-shop verification), NEVER from Claude's tool input. The Anthropic
// input_schema below intentionally does not include shopDomain — Claude has
// no surface to influence which shop's data is queried.
//
// v1 search behaviour:
//   - Free-text matches on title + productType + descriptionHtml + tag values.
//     descriptionHtml and tag values are now included in free-text matching as
//     a defensive widening — Claude's quiz-derived queries (e.g. "minimalist
//     casual") otherwise miss every product. Trade-off: slightly noisier
//     results (HTML tokens can spuriously match) until full-text indexing lands.
//   - Price filter uses Product.priceMin / priceMax (indexed) rather than
//     joining ProductVariant — overlapping-range semantics: a product matches
//     if any of its variants could plausibly fall in [price_min, price_max].
//   - Excluded products (Product.recommendationExcluded === true) are dropped.
//   - Inactive (status != 'ACTIVE') and soft-deleted (deletedAt != null)
//     products are dropped.
//   - Fully-out-of-stock products (no variant with availableForSale=true) are
//     dropped. Showing unbuyable items in recommendations or search hurts
//     conversion. Direct lookups (e.g. PDP context) bypass search_products
//     and aren't affected by this filter.

import type { Prisma } from "@prisma/client";
import prisma from "../../../db.server";
import type {
  ProductCard,
  SearchProductsInput,
  ToolDef,
  ToolExecutionContext,
  ToolResult,
} from "./types";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;

export const searchProductsTool: ToolDef = {
  name: "search_products",
  description:
    "Search the merchant's product catalog. The `query` field does case-insensitive substring matching against product title, productType, description, and tag values — pass concrete nouns or literal attributes you expect to appear in product data (e.g. 'linen', 'shorts', 'wireless', 'diamond ring'). Avoid passing abstract style concepts as the query unless they're known to be tag values on this catalog (e.g. 'minimalist outfit' or 'everyday casual' as a free-text query usually returns 0 results). For style, occasion, material, vibe, or any taste-driven facet, use `recommend_products` instead — it does semantic matching over the catalog. Use the `taxonomy` parameter when the user is browsing a known category.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text search keywords (e.g. 'linen kurta', 'wireless headphones', 'diamond ring'). Matches against product title and product type.",
      },
      price_min: {
        type: "number",
        description: "Minimum price (optional). Same currency as the store.",
      },
      price_max: {
        type: "number",
        description: "Maximum price (optional). Same currency as the store.",
      },
      taxonomy: {
        type: "string",
        description:
          "Filter by taxonomy node slug (e.g. 'tops/kurtas'). Use when the user is browsing a known category.",
      },
      limit: {
        type: "number",
        description: `Max products to return (default ${DEFAULT_LIMIT}, hard cap ${MAX_LIMIT}).`,
      },
    },
    required: ["query"],
  },
};

export async function searchProducts(
  input: SearchProductsInput,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const where: Prisma.ProductWhereInput = {
    shopDomain: ctx.shopDomain,
    status: "ACTIVE",
    deletedAt: null,
    recommendationExcluded: false,
    // Skip products with no available variants. Showing unbuyable items in
    // recommendations or search hurts conversion. Direct lookups (e.g. PDP
    // context) bypass search_products and aren't affected by this filter.
    variants: { some: { availableForSale: true } },
  };

  const q = input.query?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { productType: { contains: q, mode: "insensitive" } },
      { descriptionHtml: { contains: q, mode: "insensitive" } },
      { tags: { some: { value: { contains: q, mode: "insensitive" } } } },
    ];
  }

  if (typeof input.price_min === "number") {
    where.priceMax = { gte: input.price_min };
  }
  if (typeof input.price_max === "number") {
    where.priceMin = { lte: input.price_max };
  }

  if (input.taxonomy) {
    const node = await prisma.taxonomyNode.findFirst({
      where: { shopDomain: ctx.shopDomain, slug: input.taxonomy },
      select: { id: true },
    });
    // If the slug doesn't resolve we want zero results (not a silent fallback
    // to "all products"), so force a sentinel that won't match anything.
    where.taxonomyNodeId = node?.id ?? "__no_match__";
  }

  const limit = Math.min(
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)),
    MAX_LIMIT,
  );

  const products = await prisma.product.findMany({
    where,
    take: limit,
    orderBy: { shopifyUpdatedAt: "desc" },
    include: {
      variants: {
        take: 1,
        orderBy: [{ availableForSale: "desc" }, { price: "asc" }],
      },
      tags: { select: { axis: true, value: true } },
    },
  });

  const cards = products.map(formatProductCard);

  // Data sent back to Claude in tool_result. Slim summary only — image URLs,
  // handles, etc. would balloon token cost on every turn.
  const slim = cards.map((c) => ({
    id: c.id,
    title: c.title,
    price: c.price,
    currency: c.currency,
    available: c.available,
    tags: c.tags,
  }));

  // eslint-disable-next-line no-console, no-undef
  console.log("[search_products]", {
    shop: ctx.shopDomain,
    input,
    resultCount: cards.length,
  });

  return {
    ok: true,
    data: {
      products: slim,
      total: cards.length,
      query: input,
    },
    products: cards,
  };
}

type ProductWithRelations = Prisma.ProductGetPayload<{
  include: {
    variants: true;
    tags: { select: { axis: true; value: true } };
  };
}>;

function formatProductCard(product: ProductWithRelations): ProductCard {
  const variant = product.variants[0] ?? null;

  const price =
    variant?.price != null
      ? Number(variant.price)
      : product.priceMin != null
        ? Number(product.priceMin)
        : 0;

  const compareAtPrice =
    variant?.compareAtPrice != null && variant.compareAtPrice.toString() !== "0"
      ? Number(variant.compareAtPrice)
      : null;

  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    imageUrl: product.featuredImageUrl ?? null,
    price,
    compareAtPrice: compareAtPrice && compareAtPrice > price ? compareAtPrice : null,
    currency: product.currency ?? "USD",
    variantId: variant ? extractNumericId(variant.shopifyId) : null,
    available: variant?.availableForSale ?? false,
    tags: product.tags.map((t) => `${t.axis}:${t.value}`),
    productUrl: `/products/${product.handle}`,
  };
}

// Storefront /cart/add.js expects the numeric variant ID. Shopify GIDs look
// like `gid://shopify/ProductVariant/12345`; if the tail is non-numeric we
// return null and the widget hides Add-to-Cart for that card.
function extractNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const tail = gid.split("/").pop();
  if (!tail || !/^\d+$/.test(tail)) return null;
  return tail;
}
