// Default taxonomy trees per storeMode (006a §4.1).
//
// Trees cap at 4 levels deep (root → category → subcategory → leaf). Each
// node supplies a name, optional matchKeywords (drive the keyword-scoring
// matcher), optional axisOverrides (additive over storeMode-level axes),
// and optional children. Slugs auto-derive from name + parent path.
//
// seedTaxonomy is idempotent: it bails when the shop already has any
// TaxonomyNode rows. Triggered from upsertMerchantConfig (config-form save),
// not ensureMerchantConfig — see merchant-config.server.ts.

import type { Prisma, PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type { StoreMode } from "./store-axes";
import { slugFromPath } from "./taxonomy";

export type SeedAxisOverride = {
  axis: string;
  type?: "single" | "multi" | "text";
  values?: readonly string[];
  order?: number;
};

export type SeedNode = {
  name: string;
  matchKeywords?: readonly string[];
  axisOverrides?: readonly SeedAxisOverride[];
  children?: readonly SeedNode[];
};

export const SEED_TREES: Record<StoreMode, readonly SeedNode[]> = {
  FASHION: [
    {
      name: "Apparel",
      matchKeywords: ["apparel", "clothing"],
      children: [
        {
          name: "Tops",
          matchKeywords: ["top", "tops"],
          children: [
            { name: "Shirts", matchKeywords: ["shirt", "shirts"] },
            { name: "T-Shirts", matchKeywords: ["t-shirt", "tee", "t shirt"] },
            { name: "Kurtas", matchKeywords: ["kurta", "kurti"] },
            { name: "Polos", matchKeywords: ["polo"] },
          ],
        },
        {
          name: "Bottoms",
          matchKeywords: ["bottom", "bottoms"],
          children: [
            { name: "Pants", matchKeywords: ["pant", "pants", "trouser"] },
            { name: "Jeans", matchKeywords: ["jean", "jeans", "denim"] },
            { name: "Shorts", matchKeywords: ["short", "shorts"] },
          ],
        },
        {
          name: "Outerwear",
          matchKeywords: ["outerwear"],
          children: [
            { name: "Jackets", matchKeywords: ["jacket"] },
            { name: "Blazers", matchKeywords: ["blazer"] },
          ],
        },
        { name: "Footwear", matchKeywords: ["footwear", "shoe", "shoes"] },
      ],
    },
    {
      name: "Accessories",
      matchKeywords: ["accessory", "accessories"],
      children: [
        { name: "Belts", matchKeywords: ["belt"] },
        { name: "Bags", matchKeywords: ["bag", "handbag", "backpack"] },
        { name: "Watches", matchKeywords: ["watch", "watches"] },
      ],
    },
  ],

  ELECTRONICS: [
    {
      name: "Computing",
      matchKeywords: ["computer", "computing"],
      children: [
        { name: "Laptops", matchKeywords: ["laptop", "notebook"] },
        { name: "Tablets", matchKeywords: ["tablet", "ipad"] },
      ],
    },
    {
      name: "Mobile",
      matchKeywords: ["mobile"],
      children: [
        { name: "Phones", matchKeywords: ["phone", "smartphone"] },
        { name: "Wearables", matchKeywords: ["watch", "wearable", "tracker"] },
      ],
    },
    {
      name: "Audio",
      matchKeywords: ["audio"],
      children: [
        { name: "Headphones", matchKeywords: ["headphone", "earbuds", "earphone"] },
        { name: "Speakers", matchKeywords: ["speaker"] },
      ],
    },
    { name: "Accessories", matchKeywords: ["accessory", "accessories", "cable", "charger"] },
  ],

  FURNITURE: [
    {
      name: "Living Room",
      matchKeywords: ["living"],
      children: [
        { name: "Sofas", matchKeywords: ["sofa", "couch", "sectional"] },
        { name: "Chairs", matchKeywords: ["chair", "armchair"] },
        { name: "Tables", matchKeywords: ["table", "coffee table"] },
      ],
    },
    {
      name: "Bedroom",
      matchKeywords: ["bedroom"],
      children: [
        { name: "Beds", matchKeywords: ["bed"] },
        { name: "Storage", matchKeywords: ["dresser", "wardrobe", "storage"] },
      ],
    },
    { name: "Lighting", matchKeywords: ["lamp", "lighting", "light"] },
    { name: "Decor", matchKeywords: ["decor", "rug", "art"] },
  ],

  BEAUTY: [
    {
      name: "Skincare",
      matchKeywords: ["skincare", "skin"],
      children: [
        { name: "Cleansers", matchKeywords: ["cleanser", "wash", "cleansing"] },
        { name: "Moisturizers", matchKeywords: ["moisturizer", "cream", "lotion"] },
        { name: "Serums", matchKeywords: ["serum"] },
      ],
    },
    {
      name: "Makeup",
      matchKeywords: ["makeup"],
      children: [
        { name: "Face", matchKeywords: ["foundation", "concealer", "blush"] },
        { name: "Lips", matchKeywords: ["lipstick", "lip", "gloss"] },
        { name: "Eyes", matchKeywords: ["mascara", "eyeshadow", "eyeliner"] },
      ],
    },
    { name: "Haircare", matchKeywords: ["shampoo", "conditioner", "hair"] },
    { name: "Fragrance", matchKeywords: ["fragrance", "perfume", "cologne"] },
  ],

  GENERAL: [
    { name: "Apparel", matchKeywords: ["apparel", "clothing", "shirt", "pant"] },
    { name: "Home", matchKeywords: ["home", "decor", "kitchen"] },
    { name: "Electronics", matchKeywords: ["electronic", "device", "gadget"] },
    { name: "Accessories", matchKeywords: ["accessory", "accessories"] },
  ],
};

type Tx = PrismaClient | Prisma.TransactionClient;

export async function seedTaxonomy(
  shopDomain: string,
  storeMode: StoreMode,
  tx: Tx = prisma,
): Promise<{ created: number; skipped: boolean }> {
  // Idempotency guard: any existing rows mean a previous seed (or merchant
  // edits) already happened. Skip silently to avoid clobbering merchant work.
  const existing = await tx.taxonomyNode.count({ where: { shopDomain } });
  if (existing > 0) return { created: 0, skipped: true };

  const tree = SEED_TREES[storeMode];
  let created = 0;
  for (let i = 0; i < tree.length; i += 1) {
    created += await createSubtree(tx, shopDomain, tree[i], null, "", i);
  }
  return { created, skipped: false };
}

async function createSubtree(
  tx: Tx,
  shopDomain: string,
  node: SeedNode,
  parentId: string | null,
  parentSlug: string,
  position: number,
): Promise<number> {
  const slug = slugFromPath(parentSlug, node.name);
  const created = await tx.taxonomyNode.create({
    data: {
      shopDomain,
      parentId,
      name: node.name,
      slug,
      position,
      axisOverrides: (node.axisOverrides ?? []) as unknown as Prisma.InputJsonValue,
      matchKeywords: [...(node.matchKeywords ?? [])],
    },
  });
  let count = 1;
  const children = node.children ?? [];
  for (let i = 0; i < children.length; i += 1) {
    count += await createSubtree(tx, shopDomain, children[i], created.id, slug, i);
  }
  return count;
}
