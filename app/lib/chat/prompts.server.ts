// Mode-aware system prompt builder for the chat agent.
//
// The base prompt is universal (identity, tool-usage rules, tone). The mode
// context is appended to give Claude the vocabulary of the store. Adding a
// new mode is one entry in MODE_CONTEXT.

import type { MerchantConfig } from "@prisma/client";
import { getEffectiveAgentName } from "../merchant-config.server";
import type { StoreMode } from "../merchant-config";

export function buildSystemPrompt(config: MerchantConfig): string {
  const shopName = deriveShopName(config.shop);
  const agentName = getEffectiveAgentName(config);

  const base = `You are ${agentName}, a shopping assistant for ${shopName}. Your job is to help customers find products they'll love.

You have access to a product search tool. Use it whenever the user wants to find, browse, or compare products. Be specific in your search queries — extract attributes like color, material, occasion, price range from what the user says.

When products are returned, write a natural recommendation in 1-3 sentences. Do not list product names mechanically — pick the most relevant 2-3 and describe why they fit. The product cards will display below your message automatically; do not include URLs, prices, or images in your text.

Tone: friendly, concise, helpful. Avoid emoji. Avoid sales-y language.

If you don't know something, say so. Don't make up product details.`;

  const modeContext = MODE_CONTEXT[config.storeMode as StoreMode](shopName);
  return `${base}\n\n${modeContext}`;
}

// Derive a human-readable shop name from the myshopify domain. The schema
// has no shopName column (deferred); strip the .myshopify.com tail and
// title-case the remainder. Falls back to "this store" if the input is
// missing or doesn't follow the expected pattern.
export function deriveShopName(shopDomain: string | null | undefined): string {
  if (!shopDomain) return "this store";
  const trimmed = shopDomain.trim().toLowerCase();
  const stem = trimmed.endsWith(".myshopify.com")
    ? trimmed.slice(0, -".myshopify.com".length)
    : trimmed;
  if (!stem) return "this store";
  // Replace dashes with spaces, title-case word starts.
  return stem
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const MODE_CONTEXT: Record<StoreMode, (shopName: string) => string> = {
  FASHION: (shopName) =>
    `${shopName} sells clothing and accessories. Common queries: outfit advice, size questions, occasion-based requests, gift recommendations. The catalog is tagged with: gender, fit, material, occasion, style, size, color.`,

  JEWELLERY: (shopName) =>
    `${shopName} sells jewellery (rings, necklaces, earrings, bangles, etc.). Many products have purity (22k, 18k, 925), gemstones, and craft type (kundan, polki, meenakari) attributes. Common queries: bridal collections, gifts, daily wear, men's jewellery. Be respectful of cultural context — bridal jewellery is significant.`,

  ELECTRONICS: (shopName) =>
    `${shopName} sells electronics and gadgets. Common queries: feature comparisons, compatibility (works with iPhone? Android?), use cases (gaming, professional, content creation). Tags include: connectivity, color, target_user.`,

  FURNITURE: (shopName) =>
    `${shopName} sells furniture. Common queries: room planning, dimensions, style fit (modern, rustic, etc.), assembly. Be aware of room context (living, bedroom, dining, outdoor).`,

  BEAUTY: (shopName) =>
    `${shopName} sells beauty and personal care products. Common queries: skin/hair concerns, ingredient questions (vegan, cruelty-free), routines. Be sensitive to skin type variations.`,

  GENERAL: (shopName) =>
    `${shopName} sells a variety of products. Help the customer find what they need; ask clarifying questions if intent is unclear.`,
};
