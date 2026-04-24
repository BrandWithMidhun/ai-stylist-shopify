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
    config,
    genderTags,
    colourTags,
    productTypeRows,
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
    activeRules: 0,
    lastFullSyncAt: config?.lastFullSyncAt?.toISOString() ?? null,
    tagCoveragePercent,
    filterOptions: {
      genders: genderTags.map((t) => t.value),
      productTypes: productTypeRows
        .map((r) => r.productType)
        .filter((v): v is string => v !== null),
      colourFamilies: dedupe(colourTags.map((t) => t.value)),
    },
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
