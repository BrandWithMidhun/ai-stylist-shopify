// Starter axes per store mode. Shared between the AI tagger (which prompts
// Claude to tag along these axes) and the intelligence dashboard (which uses
// the list to compute per-product tag coverage on the ProductCard).
//
// As of Feature 005d the canonical vocabulary lives in axis-options.ts;
// STARTER_AXES is now a derived view (just the axis names per mode).

import { AXIS_OPTIONS } from "./axis-options";
import type { StoreMode } from "./store-axes-types";

export type { StoreMode };

export const STARTER_AXES: Record<StoreMode, readonly string[]> = {
  FASHION: Object.keys(AXIS_OPTIONS.FASHION),
  ELECTRONICS: Object.keys(AXIS_OPTIONS.ELECTRONICS),
  FURNITURE: Object.keys(AXIS_OPTIONS.FURNITURE),
  BEAUTY: Object.keys(AXIS_OPTIONS.BEAUTY),
  JEWELLERY: Object.keys(AXIS_OPTIONS.JEWELLERY),
  GENERAL: Object.keys(AXIS_OPTIONS.GENERAL),
};

// Hard-filter axes per store mode. Stage 1 of the v2 pipeline narrows the
// candidate set by ANDing values from extracted QueryAttributes against
// ProductTag rows with status='APPROVED'.
//
// FASHION: gender + category — the axes that feel categorically wrong if
// violated (a male user asking for shirts should never see dresses,
// regardless of semantic similarity).
//
// Other modes default empty in 3.1. Phase 5's per-mode calibration sets
// values per merchant evidence; the structural slot is here so adding
// values is a constants-only change.
//
// Phase 4 portal AI Agents config UI will surface these for merchant
// editing; until then values are code-locked.
export const HARD_FILTER_AXES: Record<StoreMode, readonly string[]> = {
  FASHION: ["gender", "category"],
  ELECTRONICS: [],
  FURNITURE: [],
  BEAUTY: [],
  JEWELLERY: [],
  GENERAL: [],
};

export function hardFilterAxesFor(
  mode: StoreMode | null | undefined,
): readonly string[] {
  return HARD_FILTER_AXES[mode ?? "GENERAL"];
}

// Axes that represent a "colour family" concept across store modes.
// Used by the filter sidebar's colour dropdown so it covers both FASHION
// (`color_family`) and GENERAL (`color`) stores.
export const COLOUR_AXES: readonly string[] = ["color_family", "color"];

export function expectedAxesFor(
  mode: StoreMode | null | undefined,
): readonly string[] {
  return STARTER_AXES[mode ?? "GENERAL"];
}
