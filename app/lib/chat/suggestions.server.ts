// Backend-computed suggestion chips for the chat widget.
//
// We don't ask Claude to generate chips — keeps responses fast and predictable,
// and avoids the classic "model picks the same three every time" rut. Logic
// branches on (isFirstMessage, hadProducts, productCount) and per-storeMode
// pools.

import type { MerchantConfig } from "@prisma/client";
import type { StoreMode } from "./../merchant-config";

export type SuggestionContext = {
  isFirstMessage: boolean;
  hadProducts: boolean;
  productCount: number;
};

// Mode-aware welcome chips per spec §3.2. Shown on the very first widget
// open before any user input. Static defaults for v1; merchant overrides
// land in a future iteration.
const WELCOME_CHIPS_BY_MODE: Record<StoreMode, string[]> = {
  FASHION: [
    "Find me something under ₹3000",
    "Help me choose size",
    "Show me best sellers",
    "Create a complete look",
  ],
  JEWELLERY: [
    "Find me a gift",
    "Show me bridal collection",
    "What's trending?",
    "Help me choose size",
  ],
  ELECTRONICS: [
    "Show me best sellers",
    "Help me compare options",
    "What's new?",
    "I'm just browsing",
  ],
  FURNITURE: [
    "Show me what's popular",
    "Help me find a sofa",
    "What's on sale?",
    "I'm just browsing",
  ],
  BEAUTY: [
    "Show me best sellers",
    "Help me with my routine",
    "What's new?",
    "I'm just browsing",
  ],
  GENERAL: [
    "Show me what's new",
    "Help me find a gift",
    "What's trending?",
    "I'm just browsing",
  ],
};

export function getWelcomeChips(storeMode: StoreMode): string[] {
  return WELCOME_CHIPS_BY_MODE[storeMode];
}

// Refinement chips offered after Claude returns products. Steers the user
// into a follow-up search that materially changes the result set.
const REFINEMENT_CHIPS = [
  "Show me cheaper options",
  "Different colors?",
  "More formal",
  "Something else",
];

// Empty-result chips offered when search returned 0 products.
const EMPTY_CHIPS = [
  "Try different keywords",
  "Browse popular items",
  "I'm just looking",
];

// Default fallback chips per storeMode for non-tool turns (small talk,
// thanks, questions Claude answered without searching).
const MODE_FALLBACK_CHIPS: Record<StoreMode, string[]> = {
  FASHION: ["Show me what's new", "Help me find a gift", "What's trending?"],
  JEWELLERY: ["Bridal collections", "Daily wear", "Help me find a gift"],
  ELECTRONICS: ["What's trending?", "Help me compare", "Best for gaming"],
  FURNITURE: ["What's new", "Living room ideas", "Help me find a gift"],
  BEAUTY: ["What's new", "Help me find a gift", "What's trending?"],
  GENERAL: ["Show me what's new", "Help me find a gift", "What's trending?"],
};

export function getSuggestions(
  config: MerchantConfig,
  ctx: SuggestionContext,
): string[] {
  // Priority: a tool call (search ran) wins over message position. Welcome
  // chips only when nothing was searched AND it's the first message — that's
  // the small-talk opener path.
  if (ctx.hadProducts && ctx.productCount > 0) return REFINEMENT_CHIPS;
  if (ctx.hadProducts && ctx.productCount === 0) return EMPTY_CHIPS;
  if (ctx.isFirstMessage) return getWelcomeChips(config.storeMode as StoreMode);
  return MODE_FALLBACK_CHIPS[config.storeMode as StoreMode];
}
