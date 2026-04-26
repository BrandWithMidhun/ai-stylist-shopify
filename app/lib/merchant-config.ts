export const CTA_LABEL_MAX = 60;
export const SHOP_DISPLAY_NAME_MAX = 60;
export const CHAT_WELCOME_MESSAGE_MAX = 280;
export const CHAT_PRIMARY_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_CHAT_PRIMARY_COLOR = "#000000";
// 011a: gradient end color is optional (null when off). When set, must
// match the same 6-digit hex format as the start color.
export const DEFAULT_CHAT_GRADIENT_ANGLE = 135;
export const CHAT_GRADIENT_ANGLE_MIN = 0;
export const CHAT_GRADIENT_ANGLE_MAX = 360;
export const DEFAULT_CHAT_WELCOME_MESSAGE =
  "Hi! I'm your shopping assistant. How can I help you today?";

export const STORE_MODES = [
  "FASHION",
  "ELECTRONICS",
  "FURNITURE",
  "BEAUTY",
  "JEWELLERY",
  "GENERAL",
] as const;
export type StoreMode = (typeof STORE_MODES)[number];

export const CTA_PLACEMENTS = [
  "PRODUCT_PAGE",
  "GLOBAL",
  "COLLECTION",
] as const;
export type CtaPlacement = (typeof CTA_PLACEMENTS)[number];

// Mode-aware default for the chat agent name shown in the storefront widget
// header. Fashion/Jewellery default to "Aria" (008 Phase 3 rebrand);
// everything else gets the generic "AI Assistant". Pure (no DB) so it lives
// here and can be imported from both server loaders and client components.
export function getDefaultAgentName(storeMode: StoreMode): string {
  switch (storeMode) {
    case "FASHION":
    case "JEWELLERY":
      return "Aria";
    default:
      return "AI Assistant";
  }
}

// Derive a human-readable shop name from the myshopify domain. Strips the
// .myshopify.com tail and title-cases the remainder. Falls back to "this
// store" if the input is missing or doesn't follow the expected pattern.
// Pure (no DB) so it can be imported from both server and client.
export function deriveShopNameFromDomain(
  shopDomain: string | null | undefined,
): string {
  if (!shopDomain) return "this store";
  const trimmed = shopDomain.trim().toLowerCase();
  const stem = trimmed.endsWith(".myshopify.com")
    ? trimmed.slice(0, -".myshopify.com".length)
    : trimmed;
  if (!stem) return "this store";
  return stem
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
