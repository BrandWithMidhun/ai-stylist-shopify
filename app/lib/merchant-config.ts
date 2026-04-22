export const CTA_LABEL_MAX = 60;

export const STORE_MODES = [
  "FASHION",
  "ELECTRONICS",
  "FURNITURE",
  "BEAUTY",
  "GENERAL",
] as const;
export type StoreMode = (typeof STORE_MODES)[number];

export const CTA_PLACEMENTS = [
  "PRODUCT_PAGE",
  "GLOBAL",
  "COLLECTION",
] as const;
export type CtaPlacement = (typeof CTA_PLACEMENTS)[number];
