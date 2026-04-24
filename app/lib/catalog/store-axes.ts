// Starter axes per store mode. Shared between the AI tagger (which prompts
// Claude to tag along these axes) and the intelligence dashboard (which uses
// the list to compute per-product tag coverage on the ProductCard).

export type StoreMode =
  | "FASHION"
  | "ELECTRONICS"
  | "FURNITURE"
  | "BEAUTY"
  | "GENERAL";

export const STARTER_AXES: Record<StoreMode, readonly string[]> = {
  FASHION: ["category", "style", "occasion", "color_family", "fit", "season"],
  ELECTRONICS: ["category", "brand", "form_factor", "use_case", "price_tier"],
  FURNITURE: ["category", "style", "material", "room", "size_class"],
  BEAUTY: ["category", "skin_type", "concern", "ingredient_class", "finish"],
  GENERAL: ["category", "color", "style", "use_case"],
};

// Axes that represent a "colour family" concept across store modes.
// Used by the filter sidebar's colour dropdown so it covers both FASHION
// (`color_family`) and GENERAL (`color`) stores.
export const COLOUR_AXES: readonly string[] = ["color_family", "color"];

export function expectedAxesFor(mode: StoreMode | null | undefined): readonly string[] {
  return STARTER_AXES[mode ?? "GENERAL"];
}
