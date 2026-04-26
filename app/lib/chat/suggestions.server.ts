// Backend-computed suggestion chips for the chat widget.
//
// We don't ask Claude to generate chips — keeps responses fast and predictable,
// and avoids the classic "model picks the same three every time" rut. Logic
// branches on (isFirstMessage, hadProducts, productCount) and per-storeMode
// pools that match 007's industry-neutral defaults.

import type { MerchantConfig } from "@prisma/client";
import type { StoreMode } from "./../merchant-config";

export type SuggestionContext = {
  isFirstMessage: boolean;
  hadProducts: boolean;
  productCount: number;
};

// Welcome chips mirror chat-widget.js's WELCOME_CHIPS for consistency.
const WELCOME_CHIPS = [
  "Show me what's new",
  "Help me find a gift",
  "What's trending?",
  "I'm just browsing",
];

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
  if (ctx.isFirstMessage) return WELCOME_CHIPS;
  return MODE_FALLBACK_CHIPS[config.storeMode as StoreMode];
}
