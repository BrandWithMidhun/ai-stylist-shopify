// Shared types for the agent's tool-calling layer (008+).
//
// Field names track the actual Prisma schema — Product.featuredImageUrl,
// ProductVariant.shopifyId (a GID), ProductVariant.availableForSale, etc.
// The variantId on ProductCard is the NUMERIC tail extracted from the GID
// (Shopify storefront /cart/add.js expects numeric IDs).

import type Anthropic from "@anthropic-ai/sdk";

// Tool definition shape passed to anthropic.messages.create({ tools: [...] }).
// Mirrors Anthropic's Tool type but kept local so callers don't import from
// the SDK directly.
export type ToolDef = {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
};

// Result shape every tool returns. Optional `products` lets the orchestrator
// collect product cards across multiple tool calls in one turn for rendering.
export type ToolResult = {
  ok: boolean;
  // Plain JSON-serializable summary that gets stringified back to Claude as
  // the tool_result content.
  data: Record<string, unknown>;
  // Out-of-band: structured product cards for rich rendering by the widget.
  // Not sent back to Claude in tool_result (would balloon tokens).
  products?: ProductCard[];
};

export type ProductCard = {
  id: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  variantId: string | null; // numeric variant ID for /cart/add.js
  available: boolean;
  tags: string[]; // formatted as "axis:value"
  productUrl: string; // /products/<handle>
};

export type SearchProductsInput = {
  query: string;
  price_min?: number;
  price_max?: number;
  tags?: string[];
  taxonomy?: string;
  limit?: number;
};

export type SearchProductsResult = {
  products: ProductCard[];
  total: number;
  query: SearchProductsInput;
};

export type ToolExecutionContext = {
  shopDomain: string;
};
