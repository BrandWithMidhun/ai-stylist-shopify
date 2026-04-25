// Per-storeMode axis definitions: field type + suggested values.
//
// Single source of truth for the tag vocabulary. Consumed by:
//   - ProductEditDrawer: drives field rendering (single/multi/text) and
//     dropdown / chip option lists
//   - ai-tagger.server.ts: passed to Claude as "common values" suggestions
//     (informed-only — the model is NOT constrained to these values; tag
//     hygiene is deferred to Feature 006)
//   - store-axes.ts: STARTER_AXES is derived from the keys of this map
//
// Adding a vertical = add one entry to AXIS_OPTIONS. Adding an axis to an
// existing vertical = add one key to that vertical's object.
//
// Axis ordering inside each storeMode object is the order the drawer renders
// fields. Reference screenshot 5 informed the FASHION ordering.
//
// Axis names stay snake_case and stable across storeModes where the concept
// is shared (e.g. `category`, `color_family`).

import type { StoreMode } from "./store-axes-types";

export type AxisFieldType = "single" | "multi" | "text";

export type AxisDefinition =
  | { type: "single"; values: readonly string[] }
  | { type: "multi"; values: readonly string[] }
  | { type: "text" };

export type AxisOptions = Record<string, AxisDefinition>;

export const AXIS_OPTIONS: Record<StoreMode, AxisOptions> = {
  FASHION: {
    gender: { type: "single", values: ["male", "female", "unisex", "kids"] },
    category: {
      type: "single",
      values: [
        "shirt",
        "t_shirt",
        "kurta",
        "pants",
        "jeans",
        "shorts",
        "dress",
        "skirt",
        "jacket",
        "sweater",
        "saree",
        "lehenga",
        "innerwear",
        "footwear",
        "accessories",
      ],
    },
    sub_category: { type: "text" },
    fit: {
      type: "single",
      values: ["slim", "regular", "relaxed", "oversized", "tailored"],
    },
    color_family: {
      type: "single",
      values: [
        "black",
        "white",
        "grey",
        "blue",
        "navy",
        "red",
        "green",
        "yellow",
        "pink",
        "purple",
        "brown",
        "beige",
        "orange",
        "multicolor",
      ],
    },
    occasion: {
      type: "multi",
      values: ["work", "casual", "travel", "event", "formal", "festive"],
    },
    style_type: {
      type: "multi",
      values: [
        "minimal",
        "classic",
        "relaxed",
        "bold",
        "preppy",
        "streetwear",
        "ethnic",
        "athleisure",
      ],
    },
    statement_piece: {
      type: "single",
      values: ["statement_piece", "not_a_statement_piece"],
    },
  },

  ELECTRONICS: {
    category: {
      type: "single",
      values: [
        "phone",
        "laptop",
        "tablet",
        "headphones",
        "speaker",
        "camera",
        "wearable",
        "tv",
        "gaming",
        "accessory",
      ],
    },
    brand: { type: "text" },
    form_factor: {
      type: "single",
      values: ["portable", "desktop", "wearable", "mounted", "handheld"],
    },
    use_case: {
      type: "multi",
      values: [
        "work",
        "gaming",
        "creative",
        "fitness",
        "home",
        "travel",
        "study",
      ],
    },
    price_tier: {
      type: "single",
      values: ["budget", "mid_range", "premium", "flagship"],
    },
  },

  FURNITURE: {
    category: {
      type: "single",
      values: [
        "sofa",
        "chair",
        "table",
        "bed",
        "storage",
        "lighting",
        "decor",
        "rug",
        "outdoor",
      ],
    },
    style: {
      type: "single",
      values: [
        "modern",
        "scandinavian",
        "industrial",
        "traditional",
        "rustic",
        "midcentury",
        "minimalist",
      ],
    },
    material: {
      type: "multi",
      values: [
        "wood",
        "metal",
        "fabric",
        "leather",
        "glass",
        "plastic",
        "rattan",
        "marble",
      ],
    },
    room: {
      type: "multi",
      values: [
        "living_room",
        "bedroom",
        "dining_room",
        "office",
        "kitchen",
        "bathroom",
        "outdoor",
      ],
    },
    size_class: {
      type: "single",
      values: ["small", "medium", "large", "oversized"],
    },
  },

  BEAUTY: {
    category: {
      type: "single",
      values: [
        "skincare",
        "makeup",
        "haircare",
        "fragrance",
        "bodycare",
        "tools",
      ],
    },
    skin_type: {
      type: "multi",
      values: ["oily", "dry", "combination", "sensitive", "normal", "all"],
    },
    concern: {
      type: "multi",
      values: [
        "acne",
        "anti_aging",
        "hydration",
        "brightening",
        "redness",
        "pores",
        "pigmentation",
      ],
    },
    ingredient_class: {
      type: "multi",
      values: [
        "vegan",
        "cruelty_free",
        "fragrance_free",
        "natural",
        "clinical",
      ],
    },
    finish: {
      type: "single",
      values: ["matte", "dewy", "satin", "glossy", "natural"],
    },
  },

  GENERAL: {
    category: { type: "text" },
    color: {
      type: "single",
      values: [
        "black",
        "white",
        "grey",
        "blue",
        "red",
        "green",
        "yellow",
        "pink",
        "brown",
        "beige",
        "multicolor",
      ],
    },
    style: { type: "text" },
    use_case: { type: "text" },
  },
};

export function axisOptionsFor(mode: StoreMode | null | undefined): AxisOptions {
  return AXIS_OPTIONS[mode ?? "GENERAL"];
}
