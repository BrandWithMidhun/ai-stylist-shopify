// Type-only split-out so axis-options.ts can import StoreMode without
// pulling in store-axes.ts (which now derives from axis-options).

export type StoreMode =
  | "FASHION"
  | "ELECTRONICS"
  | "FURNITURE"
  | "BEAUTY"
  | "GENERAL";
