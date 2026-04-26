export const CTA_LABEL_MAX = 60;

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
// header. Fashion/Jewellery default to "AI Stylist"; everything else gets the
// generic "AI Assistant". Pure (no DB) so it lives here and can be imported
// from both server loaders and client components.
export function getDefaultAgentName(storeMode: StoreMode): string {
  switch (storeMode) {
    case "FASHION":
    case "JEWELLERY":
      return "AI Stylist";
    default:
      return "AI Assistant";
  }
}
