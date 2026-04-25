// Pre-seeded tagging rules per storeMode (006a §5.5).
//
// v1 constraint (Decision 3): seeds use ONLY axes that already exist in
// axis-options.ts. We do NOT introduce new axes (no `fabric`, no
// `sleeve_length`) here. Material-style facts route through `sub_category`
// (text axis on FASHION). When no useful mapping exists for a storeMode we
// ship fewer seed rules rather than expanding the vocabulary.
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
      name: "Men's in title → gender=male",
      conditions: { kind: "title_contains", value: "men's" },
      effects: [{ axis: "gender", value: "male" }],
    },
    {
      name: "Women's in title → gender=female",
      conditions: { kind: "title_contains", value: "women's" },
      effects: [{ axis: "gender", value: "female" }],
    },
    {
      name: "Kurta → category=kurta",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "kurta" },
          { kind: "tag_contains", value: "kurta" },
        ],
      },
      effects: [{ axis: "category", value: "kurta" }],
    },
    {
      name: "Jeans → category=jeans",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "jeans" },
          { kind: "tag_contains", value: "denim" },
        ],
      },
      effects: [{ axis: "category", value: "jeans" }],
    },
    {
      name: "Linen mention → sub_category=linen",
      description: "Routes material facts through the free-text sub_category axis (v1 — no fabric axis yet).",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "linen" },
          { kind: "tag_contains", value: "linen" },
        ],
      },
      effects: [{ axis: "sub_category", value: "linen" }],
    },
    {
      name: "Cotton mention → sub_category=cotton",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "cotton" },
          { kind: "tag_contains", value: "cotton" },
        ],
      },
      effects: [{ axis: "sub_category", value: "cotton" }],
    },
  ],

  ELECTRONICS: [
    {
      name: "Phone in title → category=phone",
      conditions: { kind: "title_contains", value: "phone" },
      effects: [{ axis: "category", value: "phone" }],
    },
    {
      name: "Laptop in title → category=laptop",
      conditions: { kind: "title_contains", value: "laptop" },
      effects: [{ axis: "category", value: "laptop" }],
    },
    {
      name: "Headphones in title → category=headphones",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "headphone" },
          { kind: "title_contains", value: "earbud" },
        ],
      },
      effects: [{ axis: "category", value: "headphones" }],
    },
  ],

  FURNITURE: [
    {
      name: "Sofa in title → category=sofa",
      conditions: { kind: "title_contains", value: "sofa" },
      effects: [{ axis: "category", value: "sofa" }],
    },
    {
      name: "Chair in title → category=chair",
      conditions: { kind: "title_contains", value: "chair" },
      effects: [{ axis: "category", value: "chair" }],
    },
    {
      name: "Bed in title → category=bed",
      conditions: { kind: "title_contains", value: "bed" },
      effects: [{ axis: "category", value: "bed" }],
    },
  ],

  BEAUTY: [
    {
      name: "Cleanser/serum/moisturizer → category=skincare",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "cleanser" },
          { kind: "title_contains", value: "serum" },
          { kind: "title_contains", value: "moisturizer" },
        ],
      },
      effects: [{ axis: "category", value: "skincare" }],
    },
    {
      name: "Lipstick/foundation → category=makeup",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "lipstick" },
          { kind: "title_contains", value: "foundation" },
          { kind: "title_contains", value: "mascara" },
        ],
      },
      effects: [{ axis: "category", value: "makeup" }],
    },
    {
      name: "Shampoo/conditioner → category=haircare",
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "shampoo" },
          { kind: "title_contains", value: "conditioner" },
        ],
      },
      effects: [{ axis: "category", value: "haircare" }],
    },
  ],

  // GENERAL stores have only text axes for category/style/use_case so a
  // deterministic seed rule has no canonical value to write. Ship empty;
  // merchants can author rules from the Rules page.
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
