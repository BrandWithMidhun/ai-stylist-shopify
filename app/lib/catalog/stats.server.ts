// Catalog intelligence dashboard stats.
//
// Shared between the GET /api/catalog/stats route and the dashboard loader
// (app.products.intelligence.tsx). Returns all 8 stat card values, the tag
// coverage percent for the guide header, and filter dropdown options.
//
// All counts run in parallel via Promise.all. The AI/Rule-tagged count and
// Human-reviewed count are independent (can overlap) per spec §6.2.

import prisma from "../../db.server";
import { COLOUR_AXES } from "./store-axes";

export type DashboardStats = {
  totalProducts: number;
  live: number;
  outOfStock: number;
  draft: number;
  archived: number;
  pendingTag: number;
  aiOrRuleTagged: number;
  humanReviewed: number;
  activeRules: number;
  lastFullSyncAt: string | null;
  tagCoveragePercent: number;
  filterOptions: {
    genders: string[];
    productTypes: string[];
    colourFamilies: string[];
  };
  // Shop-wide counts for the FilterSidebar. Computed against the full catalog,
  // not the 500-product loader window, so the numbers track totalProducts.
  // Tag-status buckets follow computeTagStatus() priority (HUMAN > RULE > AI >
  // pending), so a product appears in exactly one of pending/aiTagged/
  // ruleTagged/humanReviewed.
  tagStatusCounts: {
    all: number;
    pending: number;
    anyTagged: number;
    aiTagged: number;
    ruleTagged: number;
    humanReviewed: number;
  };
  stockStatusCounts: {
    all: number;
    live: number;
    outOfStock: number;
    draft: number;
    archived: number;
  };
  recommendationCounts: {
    all: number;
    included: number;
    excluded: number;
  };
};

export async function loadDashboardStats(
  shopDomain: string,
): Promise<DashboardStats> {
  const baseWhere = { shopDomain, deletedAt: null };

  const [
    totalProducts,
    live,
    outOfStock,
    draft,
    archived,
    pendingTag,
    aiOrRuleTagged,
    humanReviewed,
    aiTaggedExclusive,
    ruleTaggedExclusive,
    excludedFromRecs,
    config,
    genderTags,
    colourTags,
    productTypeRows,
    activeRules,
  ] = await Promise.all([
    prisma.product.count({ where: baseWhere }),
    prisma.product.count({
      where: {
        ...baseWhere,
        status: "ACTIVE",
        inventoryStatus: { in: ["IN_STOCK", "LOW_STOCK"] },
      },
    }),
    prisma.product.count({
      where: { ...baseWhere, inventoryStatus: "OUT_OF_STOCK" },
    }),
    prisma.product.count({ where: { ...baseWhere, status: "DRAFT" } }),
    prisma.product.count({ where: { ...baseWhere, status: "ARCHIVED" } }),
    prisma.product.count({
      where: { ...baseWhere, tags: { none: {} } },
    }),
    prisma.product.count({
      where: {
        ...baseWhere,
        tags: { some: { source: { in: ["AI", "RULE"] } } },
      },
    }),
    prisma.product.count({
      where: { ...baseWhere, tags: { some: { source: "HUMAN" } } },
    }),
    // Filter bucket counts mirror computeTagStatus() priority. "AI tagged"
    // here means "has AI tag, no RULE tag, no HUMAN tag" so the count equals
    // the number of products applyFilters() returns when status="ai_tagged".
    prisma.product.count({
      where: {
        ...baseWhere,
        AND: [
          { tags: { some: { source: "AI" } } },
          { tags: { none: { source: "RULE" } } },
          { tags: { none: { source: "HUMAN" } } },
        ],
      },
    }),
    prisma.product.count({
      where: {
        ...baseWhere,
        AND: [
          { tags: { some: { source: "RULE" } } },
          { tags: { none: { source: "HUMAN" } } },
        ],
      },
    }),
    prisma.product.count({
      where: { ...baseWhere, recommendationExcluded: true },
    }),
    prisma.merchantConfig.findUnique({
      where: { shop: shopDomain },
      select: { lastFullSyncAt: true },
    }),
    prisma.productTag.findMany({
      where: { shopDomain, axis: "gender" },
      distinct: ["value"],
      select: { value: true },
      orderBy: { value: "asc" },
    }),
    prisma.productTag.findMany({
      where: { shopDomain, axis: { in: [...COLOUR_AXES] } },
      distinct: ["value"],
      select: { value: true },
      orderBy: { value: "asc" },
    }),
    prisma.product.findMany({
      where: { ...baseWhere, productType: { not: null } },
      distinct: ["productType"],
      select: { productType: true },
      orderBy: { productType: "asc" },
    }),
    prisma.taggingRule.count({ where: { shopDomain, enabled: true } }),
  ]);

  const tagCoveragePercent =
    totalProducts === 0
      ? 0
      : Math.round(((totalProducts - pendingTag) / totalProducts) * 100);

  return {
    totalProducts,
    live,
    outOfStock,
    draft,
    archived,
    pendingTag,
    aiOrRuleTagged,
    humanReviewed,
    activeRules,
    lastFullSyncAt: config?.lastFullSyncAt?.toISOString() ?? null,
    tagCoveragePercent,
    filterOptions: {
      genders: genderTags.map((t) => t.value),
      productTypes: productTypeRows
        .map((r) => r.productType)
        .filter((v): v is string => v !== null),
      colourFamilies: dedupe(colourTags.map((t) => t.value)),
    },
    tagStatusCounts: {
      all: totalProducts,
      pending: pendingTag,
      anyTagged: totalProducts - pendingTag,
      aiTagged: aiTaggedExclusive,
      ruleTagged: ruleTaggedExclusive,
      humanReviewed,
    },
    stockStatusCounts: {
      all: totalProducts,
      live,
      outOfStock,
      draft,
      archived,
    },
    recommendationCounts: {
      all: totalProducts,
      included: totalProducts - excludedFromRecs,
      excluded: excludedFromRecs,
    },
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
