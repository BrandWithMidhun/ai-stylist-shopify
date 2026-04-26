// Per-storeMode axis definitions: field type + suggested values.
//
// Single source of truth for the tag vocabulary. Consumed by:
//   - ProductEditDrawer: drives field rendering (single/multi/text) and
//     dropdown / chip option lists
//   - ai-tagger.server.ts: passed to Claude as "common values" suggestions
//     (informed-only — the model is NOT constrained to these values; tag
//     hygiene is deferred to Feature 006)
//   - store-axes.ts: STARTER_AXES is derived from the keys of this map
//   - rule-seeds.ts: seed rules MUST only write values that exist in this
//     vocabulary (006a Decision 3)
//
// Adding a vertical = add one entry to AXIS_OPTIONS. Adding an axis to an
// existing vertical = add one key to that vertical's object.
//
// Axis ordering inside each storeMode object is the order the drawer renders
// fields. Axis names stay snake_case and stable across storeModes where the
// concept is shared (e.g. `category`, `color_family`, `price_tier`).

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
    material: {
      type: "multi",
      values: [
        "cotton",
        "linen",
        "silk",
        "denim",
        "wool",
        "polyester",
        "leather",
        "synthetic",
        "blended",
        "cashmere",
      ],
    },
    size_range: {
      type: "multi",
      values: ["xs", "s", "m", "l", "xl", "xxl", "xxxl", "one_size"],
    },
    price_tier: {
      type: "single",
      values: ["budget", "mid_range", "premium", "luxury"],
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
    connectivity: {
      type: "multi",
      values: [
        "wifi",
        "bluetooth",
        "wired",
        "cellular",
        "nfc",
        "usb_c",
        "lightning",
      ],
    },
    color: {
      type: "single",
      values: [
        "black",
        "white",
        "grey",
        "silver",
        "gold",
        "blue",
        "red",
        "multicolor",
        "clear",
      ],
    },
    target_user: {
      type: "multi",
      values: ["gamer", "professional", "casual", "student", "creator"],
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
    color: {
      type: "single",
      values: [
        "black",
        "white",
        "grey",
        "blue",
        "red",
        "green",
        "brown",
        "beige",
        "multicolor",
        "natural_wood",
        "metallic",
      ],
    },
    assembly_required: {
      type: "single",
      values: ["yes", "no", "minimal", "professional"],
    },
    price_tier: {
      type: "single",
      values: ["budget", "mid_range", "premium", "luxury"],
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
    hair_type: {
      type: "multi",
      values: [
        "straight",
        "wavy",
        "curly",
        "coily",
        "fine",
        "thick",
        "damaged",
        "colored",
        "oily",
        "dry",
      ],
    },
    formulation: {
      type: "single",
      values: [
        "cream",
        "serum",
        "oil",
        "gel",
        "lotion",
        "spray",
        "powder",
        "stick",
        "liquid",
        "mask",
      ],
    },
    price_tier: {
      type: "single",
      values: ["budget", "mid_range", "premium", "luxury"],
    },
  },

  JEWELLERY: {
    category: {
      type: "single",
      values: [
        "ring",
        "necklace",
        "earrings",
        "bracelet",
        "pendant",
        "bangle",
        "anklet",
        "brooch",
        "mangalsutra",
        "watch",
        "nose_ring",
        "set",
      ],
    },
    metal: {
      type: "single",
      values: [
        "gold",
        "silver",
        "platinum",
        "rose_gold",
        "white_gold",
        "mixed_metal",
        "alloy",
        "brass",
        "copper",
        "fashion_metal",
      ],
    },
    purity: {
      type: "single",
      values: [
        "24k",
        "22k",
        "18k",
        "14k",
        "10k",
        "925_silver",
        "800_silver",
        "oxidized",
        "plated",
        "costume",
      ],
    },
    gemstone: {
      type: "multi",
      values: [
        "diamond",
        "ruby",
        "emerald",
        "sapphire",
        "pearl",
        "opal",
        "topaz",
        "amethyst",
        "garnet",
        "none",
        "synthetic",
        "simulated",
        "other",
      ],
    },
    craft_type: {
      type: "multi",
      values: [
        "kundan",
        "polki",
        "meenakari",
        "temple",
        "oxidized",
        "filigree",
        "beaded",
        "threadwork",
        "plain",
      ],
    },
    weight_grams: { type: "text" },
    occasion: {
      type: "multi",
      values: [
        "bridal",
        "daily",
        "festive",
        "party",
        "gift",
        "traditional",
        "office",
        "religious",
      ],
    },
    style: {
      type: "single",
      values: [
        "traditional",
        "contemporary",
        "minimalist",
        "statement",
        "vintage",
        "fusion",
        "antique",
        "fashion",
      ],
    },
    target_audience: {
      type: "single",
      values: ["male", "female", "unisex", "kids", "infant"],
    },
    price_tier: {
      type: "single",
      values: ["budget", "mid_range", "premium", "luxury", "fine_jewellery"],
    },
    certification: {
      type: "multi",
      values: ["bis_hallmark", "gia", "igi", "hrd", "none"],
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
    price_tier: {
      type: "single",
      values: ["budget", "mid_range", "premium", "luxury"],
    },
    size: { type: "text" },
    target_audience: { type: "text" },
  },
};

export function axisOptionsFor(mode: StoreMode | null | undefined): AxisOptions {
  return AXIS_OPTIONS[mode ?? "GENERAL"];
}
