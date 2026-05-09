// Thread 2 probe — read-only Stage 1 instrumentation per fixture.
//
// Uses production modules (no logic duplication):
//   - stage1HardFilters from app/lib/recommendations/v2/stage-1-hard-filters.server
//   - extractQueryAttributes from app/lib/recommendations/v2/stage-3-rerank/query-extraction.server
//   - prisma from app/db.server
//
// Does NOT call Voyage (no Stage 2 invocation).
// Does NOT write any DB rows.
//
// Output:
//   .pr-3-1-7-planning-artifacts/14-stage-1-per-fixture-output.json
//
// Run via:
//   npx tsx --env-file=.env .pr-3-1-7-planning-artifacts/probe-stage-1.ts

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import prisma from "../app/db.server";
import { stage1HardFilters } from "../app/lib/recommendations/v2/stage-1-hard-filters.server";
import { extractQueryAttributes } from "../app/lib/recommendations/v2/stage-3-rerank/query-extraction.server";

const SHOP = "ai-fashion-store.myshopify.com";
const FIXTURE_DIR = path.join(
  process.cwd(),
  "app",
  "lib",
  "recommendations",
  "v2",
  "eval",
  "fixtures",
);
const OUT_PATH = path.join(
  process.cwd(),
  ".pr-3-1-7-planning-artifacts",
  "14-stage-1-per-fixture-output.json",
);

type Fixture = {
  fixtureKey: string;
  mode: string;
  intent: string;
  expectedHandles: string[];
  expectedTagFilters: Record<string, string[]>;
  k: number;
  notes?: string;
};

function loadFixtures(): Fixture[] {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")))
    .sort((a, b) => a.fixtureKey.localeCompare(b.fixtureKey));
}

async function censusByAxis(): Promise<Record<string, { APPROVED: number; PENDING_REVIEW: number; REJECTED: number }>> {
  const rows = await prisma.productTag.groupBy({
    by: ["axis", "status"],
    where: { shopDomain: SHOP },
    _count: { _all: true },
  });
  const out: Record<string, { APPROVED: number; PENDING_REVIEW: number; REJECTED: number }> = {};
  for (const r of rows) {
    if (!out[r.axis]) out[r.axis] = { APPROVED: 0, PENDING_REVIEW: 0, REJECTED: 0 };
    if (r.status === "APPROVED" || r.status === "PENDING_REVIEW" || r.status === "REJECTED") {
      out[r.axis][r.status as "APPROVED" | "PENDING_REVIEW" | "REJECTED"] = r._count._all;
    }
  }
  return out;
}

async function approvedProductCountForAxis(axis: string): Promise<number> {
  const rows = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis, status: "APPROVED" },
    distinct: ["productId"],
    select: { productId: true },
  });
  return rows.length;
}

async function approvedProductCountForAxisValue(axis: string, values: string[]): Promise<number> {
  if (values.length === 0) return 0;
  const rows = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis, status: "APPROVED", value: { in: values } },
    distinct: ["productId"],
    select: { productId: true },
  });
  return rows.length;
}

async function main() {
  const fixtures = loadFixtures();
  console.log(`Loaded ${fixtures.length} fixtures from ${FIXTURE_DIR}`);

  // Total catalog snapshot.
  const totalProducts = await prisma.product.count({ where: { shopDomain: SHOP } });
  const activeProducts = await prisma.product.count({
    where: {
      shopDomain: SHOP,
      status: "ACTIVE",
      deletedAt: null,
      recommendationExcluded: false,
    },
  });
  // embedding is a pgvector column — not exposed in Prisma's typed model.
  const activeWithEmbeddingRows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*)::bigint AS c FROM "Product"
       WHERE "shopDomain" = $1
         AND status = 'ACTIVE'
         AND "deletedAt" IS NULL
         AND "recommendationExcluded" = false
         AND embedding IS NOT NULL`,
    SHOP,
  );
  const activeWithEmbedding = Number(activeWithEmbeddingRows[0]?.c ?? 0);
  // Also: how many ACTIVE+embedded products have an available variant — i.e.
  // the structural Stage 1 input universe BEFORE per-axis APPROVED filters.
  const stage1UniverseRows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
    `SELECT COUNT(*)::bigint AS c FROM "Product" p
       WHERE p."shopDomain" = $1
         AND p.status = 'ACTIVE'
         AND p."deletedAt" IS NULL
         AND p."recommendationExcluded" = false
         AND p.embedding IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM "ProductVariant" v
           WHERE v."productId" = p.id AND v."availableForSale" = true
         )`,
    SHOP,
  );
  const stage1Universe = Number(stage1UniverseRows[0]?.c ?? 0);
  const distinctApprovedProducts = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, status: "APPROVED" },
    distinct: ["productId"],
    select: { productId: true },
  });

  const census = await censusByAxis();

  // Per-axis: how many distinct products have at least one APPROVED tag on that axis.
  const axesOfInterest = [
    "gender",
    "category",
    "sub_category",
    "occasion",
    "color_family",
    "material",
    "fit",
    "season",
    "size_range",
    "style_type",
    "sleeve_length",
    "pattern",
    "collar_type",
    "price_tier",
    "statement_piece",
  ];
  const approvedProductsByAxis: Record<string, number> = {};
  for (const axis of axesOfInterest) {
    approvedProductsByAxis[axis] = await approvedProductCountForAxis(axis);
  }

  // Per-fixture Stage 1 probe.
  const perFixture: unknown[] = [];
  for (const fix of fixtures) {
    const queryAttributes = extractQueryAttributes(fix.intent, "FASHION");

    const stage1Out = await stage1HardFilters(
      { shopDomain: SHOP, intent: fix.intent },
      queryAttributes,
      "FASHION",
    );

    const candidateIds = stage1Out.candidates.map((c) => c.id);
    const candidateHandles = stage1Out.candidates.map((c) => c.handle).slice(0, 20);

    // For the surviving candidates: how many have APPROVED tags on each axis the
    // fixture's expectedTagFilters lists?
    const tagCoverage: Record<string, { withApprovedOnAxis: number; satisfyingFilter: number }> = {};
    if (candidateIds.length > 0) {
      for (const [axis, allowedValues] of Object.entries(fix.expectedTagFilters)) {
        const approvedRows = await prisma.productTag.findMany({
          where: {
            shopDomain: SHOP,
            axis,
            status: "APPROVED",
            productId: { in: candidateIds },
          },
          select: { productId: true, value: true },
        });
        const productsWithApproved = new Set(approvedRows.map((r) => r.productId));
        const allowedSet = new Set(allowedValues);
        const productsSatisfying = new Set(
          approvedRows.filter((r) => allowedSet.has(r.value)).map((r) => r.productId),
        );
        tagCoverage[axis] = {
          withApprovedOnAxis: productsWithApproved.size,
          satisfyingFilter: productsSatisfying.size,
        };
      }
    } else {
      for (const axis of Object.keys(fix.expectedTagFilters)) {
        tagCoverage[axis] = { withApprovedOnAxis: 0, satisfyingFilter: 0 };
      }
    }

    // Catalog-wide check: how many products in the whole shop have an APPROVED
    // tag matching the extracted hard-filter values?
    const hardFilterCatalogCounts: Record<string, { axis: string; values: string[]; catalogProductsApprovedMatching: number }> = {};
    for (const axis of ["gender", "category"] as const) {
      const values = queryAttributes[axis] ?? [];
      if (values.length > 0) {
        hardFilterCatalogCounts[axis] = {
          axis,
          values,
          catalogProductsApprovedMatching: await approvedProductCountForAxisValue(axis, values),
        };
      }
    }

    perFixture.push({
      fixtureKey: fix.fixtureKey,
      intent: fix.intent,
      expectedTagFilters: fix.expectedTagFilters,
      extractedQueryAttributes: queryAttributes,
      stage1: {
        candidatesReturned: stage1Out.candidates.length,
        latencyMs: stage1Out.contribution.ms,
        firstCandidateHandles: candidateHandles,
        filtersApplied: stage1Out.contribution.meta?.filtersApplied,
        hardFilterAxesActive: stage1Out.contribution.meta?.hardFilterAxesActive,
      },
      hardFilterCatalogCounts,
      tagCoverageOnSurvivors: tagCoverage,
    });
  }

  const out = {
    capturedAt: new Date().toISOString(),
    shop: SHOP,
    catalog: {
      totalProducts,
      activeNotDeletedNotExcluded: activeProducts,
      activeWithEmbedding,
      stage1UniverseStructural: stage1Universe,
      distinctProductsWithAnyApprovedTag: distinctApprovedProducts.length,
    },
    productTagCensusByAxisAndStatus: census,
    distinctProductsWithApprovedTagPerAxis: approvedProductsByAxis,
    perFixture,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-undef, no-console
  console.error(e);
  process.exit(1);
});
