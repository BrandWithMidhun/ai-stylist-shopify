// Pre-seeded tagging rules per storeMode (006a §5.5).
//
// All seeds use ONLY values from the expanded axis-options.ts vocabulary
// (006a Decision 3). Rules write source="RULE", confidence=1.0, locked=false
// at apply time (rule-engine.server.ts). Locking remains HUMAN-only.
//
// Conditions are typed via the Condition union from rule-types.ts. Effects
// use string for single-value axes and string[] for multi-value axes —
// applyRules writes the full set in one shot, then blocks the axis from
// further rule writes (first-match-wins per axis, Decision 4).
//
// seedRules is idempotent: it bails when the shop already has any
// TaggingRule rows. Triggered from upsertMerchantConfig alongside seedTaxonomy.

import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type { Condition, Effect } from "./rule-types";
import type { StoreMode } from "./store-axes";

export type RuleSeed = {
  name: string;
  description?: string;
  priority?: number;
  conditions: Condition;
  effects: Effect[];
};

export const SEED_RULES: Record<StoreMode, readonly RuleSeed[]> = {
  FASHION: [
    {
      name: "Men's products",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "men's" },
          { kind: "tag_contains", value: "men's" },
        ],
      },
      effects: [{ axis: "gender", value: "male" }],
    },
    {
      name: "Women's products",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "women's" },
          { kind: "tag_contains", value: "women's" },
        ],
      },
      effects: [{ axis: "gender", value: "female" }],
    },
    {
      name: "Unisex products",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "unisex" },
          { kind: "tag_contains", value: "unisex" },
        ],
      },
      effects: [{ axis: "gender", value: "unisex" }],
    },
    {
      name: "Kids products",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "kids" },
          { kind: "title_contains", value: "children" },
          { kind: "tag_contains", value: "kids" },
        ],
      },
      effects: [{ axis: "gender", value: "kids" }],
    },
    {
      name: "Linen material",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "linen" },
          { kind: "title_contains", value: "linen" },
        ],
      },
      effects: [{ axis: "material", value: ["linen"] }],
    },
    {
      name: "Cotton material",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "cotton" },
          { kind: "title_contains", value: "cotton" },
        ],
      },
      effects: [{ axis: "material", value: ["cotton"] }],
    },
    {
      name: "Denim material",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "denim" },
          { kind: "title_contains", value: "jeans" },
        ],
      },
      effects: [{ axis: "material", value: ["denim"] }],
    },
  ],

  ELECTRONICS: [
    {
      name: "Gaming products",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "gaming" },
          { kind: "title_contains", value: "gaming" },
        ],
      },
      effects: [
        { axis: "use_case", value: ["gaming"] },
        { axis: "target_user", value: ["gamer"] },
      ],
    },
    {
      name: "Wireless connectivity",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "wireless" },
          { kind: "title_contains", value: "bluetooth" },
        ],
      },
      effects: [{ axis: "connectivity", value: ["bluetooth"] }],
    },
    {
      name: "Professional grade",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "professional" },
          { kind: "title_contains", value: " pro " },
        ],
      },
      effects: [{ axis: "target_user", value: ["professional"] }],
    },
  ],

  FURNITURE: [
    {
      name: "Outdoor location",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "outdoor" },
          { kind: "title_contains", value: "outdoor" },
          { kind: "title_contains", value: "patio" },
        ],
      },
      effects: [{ axis: "room", value: ["outdoor"] }],
    },
    {
      name: "Wood material",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "wood" },
          { kind: "title_contains", value: "wooden" },
        ],
      },
      effects: [{ axis: "material", value: ["wood"] }],
    },
    {
      name: "Metal material",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "metal" },
          { kind: "title_contains", value: "steel" },
        ],
      },
      effects: [{ axis: "material", value: ["metal"] }],
    },
    {
      name: "Modern style",
      conditions: { kind: "title_contains", value: "modern" },
      effects: [{ axis: "style", value: "modern" }],
    },
    {
      name: "Rustic style",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "rustic" },
          { kind: "title_contains", value: "vintage" },
        ],
      },
      effects: [{ axis: "style", value: "rustic" }],
    },
  ],

  BEAUTY: [
    {
      name: "Vegan products",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "vegan" },
          { kind: "title_contains", value: "vegan" },
        ],
      },
      effects: [{ axis: "ingredient_class", value: ["vegan"] }],
    },
    {
      name: "Cruelty-free products",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "cruelty-free" },
          { kind: "tag_contains", value: "cruelty free" },
          { kind: "title_contains", value: "cruelty" },
        ],
      },
      effects: [{ axis: "ingredient_class", value: ["cruelty_free"] }],
    },
    {
      name: "Anti-aging concern",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "anti-aging" },
          { kind: "tag_contains", value: "anti aging" },
          { kind: "title_contains", value: "anti-aging" },
        ],
      },
      effects: [{ axis: "concern", value: ["anti_aging"] }],
    },
    {
      name: "Moisturizer category",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "moisturizer" },
          { kind: "title_contains", value: "moisturising" },
          { kind: "title_contains", value: "moisturiser" },
        ],
      },
      effects: [{ axis: "category", value: "skincare" }],
    },
    {
      name: "Shampoo category",
      conditions: { kind: "title_contains", value: "shampoo" },
      effects: [{ axis: "category", value: "haircare" }],
    },
  ],

  JEWELLERY: [
    {
      name: "Gold metal",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "gold" },
          { kind: "title_contains", value: "gold" },
        ],
      },
      effects: [{ axis: "metal", value: "gold" }],
    },
    {
      name: "Silver metal",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "silver" },
          { kind: "title_contains", value: "silver" },
        ],
      },
      effects: [{ axis: "metal", value: "silver" }],
    },
    {
      name: "Diamond gemstone",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "diamond" },
          { kind: "title_contains", value: "diamond" },
        ],
      },
      effects: [{ axis: "gemstone", value: ["diamond"] }],
    },
    {
      name: "Bridal occasion",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "bridal" },
          { kind: "title_contains", value: "bridal" },
          { kind: "title_contains", value: "wedding" },
        ],
      },
      effects: [{ axis: "occasion", value: ["bridal"] }],
    },
    {
      name: "Men's jewellery",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "men's" },
          { kind: "title_contains", value: "men's" },
        ],
      },
      effects: [{ axis: "target_audience", value: "male" }],
    },
    {
      name: "Kids jewellery",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "kids" },
          { kind: "title_contains", value: "kids" },
          { kind: "title_contains", value: "children" },
        ],
      },
      effects: [{ axis: "target_audience", value: "kids" }],
    },
    {
      name: "Kundan craft",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "kundan" },
          { kind: "title_contains", value: "kundan" },
        ],
      },
      effects: [{ axis: "craft_type", value: ["kundan"] }],
    },
    {
      name: "Polki craft",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "tag_contains", value: "polki" },
          { kind: "title_contains", value: "polki" },
        ],
      },
      effects: [{ axis: "craft_type", value: ["polki"] }],
    },
    {
      name: "22k purity",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "22k" },
          { kind: "title_contains", value: "22 carat" },
          { kind: "title_contains", value: "22ct" },
        ],
      },
      effects: [{ axis: "purity", value: "22k" }],
    },
  ],

  // GENERAL: merchants define rules from scratch — no canonical vocabulary
  // exists across arbitrary catalogs (text axes have no fixed values).
  GENERAL: [],
};

type Tx = PrismaClient | Prisma.TransactionClient;

export async function seedRules(
  shopDomain: string,
  storeMode: StoreMode,
  tx: Tx = prisma,
): Promise<{ created: number; skipped: boolean }> {
  const existing = await tx.taggingRule.count({ where: { shopDomain } });
  if (existing > 0) return { created: 0, skipped: true };

  const seeds = SEED_RULES[storeMode];
  if (seeds.length === 0) return { created: 0, skipped: false };

  let created = 0;
  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    await tx.taggingRule.create({
      data: {
        shopDomain,
        name: seed.name,
        description: seed.description ?? null,
        enabled: true,
        priority: seed.priority ?? 100 + i,
        conditions: seed.conditions as unknown as Prisma.InputJsonValue,
        effects: seed.effects as unknown as Prisma.InputJsonValue,
      },
    });
    created += 1;
  }
  return { created, skipped: false };
}
