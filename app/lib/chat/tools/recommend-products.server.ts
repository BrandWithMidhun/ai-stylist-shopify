// recommend_products tool — semantic retrieval via Voyage + pgvector.
//
// SECURITY: shopDomain MUST come from the ToolExecutionContext (route-
// scoped installed-shop verification), NEVER from Claude's tool input.
// The Anthropic input_schema below intentionally does not include
// shopDomain — Claude has no surface to influence which shop's catalog
// is queried. Same model as search_products.
//
// Two-stage rendering: we always retrieve a 30-product candidate pool
// (CANDIDATE_POOL_SIZE) so Claude has enough semantic context to write
// a thoughtful recommendation. The widget only renders the top
// `input.limit ?? 6` cards by similarity — full pool would look spammy
// in the chat UI. Slim summary sent back to Claude in tool_result
// covers all 30 so Claude can compare options before picking 2-3 to
// highlight in its text.
//
// formatProductCard / extractNumericId duplicate the shape used by
// search-products.server.ts. Not refactored to a shared util — v1
// constraint is to keep the search path untouched (per execution plan).
// If a third tool needs the same formatter, hoist then.

import { embedQuery } from "../../embeddings/voyage.server";
import {
  findSimilarProducts,
  type SimilarProductRow,
} from "../../embeddings/similarity-search.server";
import type {
  ProductCard,
  ToolDef,
  ToolExecutionContext,
  ToolResult,
} from "./types";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
const CANDIDATE_POOL_SIZE = 30;

export type RecommendProductsInput = {
  intent: string;
  price_min?: number;
  price_max?: number;
  limit?: number;
};

export const recommendProductsTool: ToolDef = {
  name: "recommend_products",
  description:
    "Recommend products to the user using semantic similarity over the merchant's catalog. Use this when the user is open to suggestions: post-quiz auto-send, 'what should I get', 'anything for me', 'help me browse', 'recommend something'. Pass a RICH `intent` string that synthesizes the user's profile, lifestyle, and current message into one descriptive phrase — the embedding match is only as good as the intent. Example good intents: 'minimalist linen shirts for casual everyday wear, neutral colors', 'rose gold pendant necklace for daily wear, traditional aesthetic'. Avoid generic intents like 'shirts' or 'jewellery' — those waste the semantic signal. For specific keyword searches like 'linen kurta size XL', use `search_products` instead — it's better at literal title matching.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        description:
          "Rich natural-language description of what the user is looking for. Synthesize the user's profile (gender, lifestyle, style vibe, color preferences) with their current message into one phrase. Better intent = better match.",
      },
      price_min: {
        type: "number",
        description: "Minimum price (optional). Same currency as the store.",
      },
      price_max: {
        type: "number",
        description: "Maximum price (optional). Same currency as the store.",
      },
      limit: {
        type: "number",
        description: `Max product cards to render (default ${DEFAULT_LIMIT}, hard cap ${MAX_LIMIT}). Claude still sees all ${CANDIDATE_POOL_SIZE} candidates internally.`,
      },
    },
    required: ["intent"],
  },
};

export async function recommendProducts(
  input: RecommendProductsInput,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const intent = input.intent?.trim();
  if (!intent) {
    return { ok: false, data: { error: "intent_required" } };
  }

  const queryVector = await embedQuery(intent);

  const candidates = await findSimilarProducts({
    shopDomain: ctx.shopDomain,
    queryVector,
    limit: CANDIDATE_POOL_SIZE,
    priceMin: input.price_min,
    priceMax: input.price_max,
  });

  const cards = candidates.map(formatProductCard);

  // Slim summary sent back to Claude in tool_result. Mirrors
  // search_products.slim — no image URLs or full descriptions to keep
  // per-turn token cost predictable.
  const slim = cards.map((c) => ({
    id: c.id,
    title: c.title,
    price: c.price,
    currency: c.currency,
    available: c.available,
    tags: c.tags,
  }));

  const cardLimit = Math.min(
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)),
    MAX_LIMIT,
  );
  const topCards = cards.slice(0, cardLimit);

  // eslint-disable-next-line no-console, no-undef
  console.log("[recommend_products]", {
    shop: ctx.shopDomain,
    intent: input.intent,
    priceMin: input.price_min,
    priceMax: input.price_max,
    candidatesReturned: cards.length,
    topDistance: candidates[0]?.distance ?? null,
  });

  return {
    ok: true,
    data: {
      products: slim,
      total: cards.length,
      query: input,
    },
    products: topCards,
  };
}

function formatProductCard(p: SimilarProductRow): ProductCard {
  const variant = p.variants[0] ?? null;

  const price =
    variant?.price != null
      ? Number(variant.price)
      : p.priceMin != null
        ? Number(p.priceMin)
        : 0;

  const compareAtPrice =
    variant?.compareAtPrice != null && variant.compareAtPrice.toString() !== "0"
      ? Number(variant.compareAtPrice)
      : null;

  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    imageUrl: p.featuredImageUrl ?? null,
    price,
    compareAtPrice:
      compareAtPrice && compareAtPrice > price ? compareAtPrice : null,
    currency: p.currency ?? "USD",
    variantId: variant ? extractNumericId(variant.shopifyId) : null,
    available: variant?.availableForSale ?? false,
    tags: p.tags.map((t) => `${t.axis}:${t.value}`),
    productUrl: `/products/${p.handle}`,
  };
}

function extractNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const tail = gid.split("/").pop();
  if (!tail || !/^\d+$/.test(tail)) return null;
  return tail;
}
