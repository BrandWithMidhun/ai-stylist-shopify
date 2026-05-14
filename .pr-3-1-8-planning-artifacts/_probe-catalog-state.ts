// Thread 2 probe — consolidated catalog-state for op debts #43/#45/#46/#49.
//
// Reconfirms the empirical state cited in HANDOFF op debt entries hasn't
// drifted since 3.1.7 mech.X.5 captures. No DB writes.
//
// Output: .pr-3-1-8-planning-artifacts/_catalog-state-output.txt
//
// Run: npx tsx --env-file=.env .pr-3-1-8-planning-artifacts/_probe-catalog-state.ts

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import prisma from "../app/db.server";

const SHOP = "ai-fashion-store.myshopify.com";

const OUT_PATH = path.join(
  process.cwd(),
  ".pr-3-1-8-planning-artifacts",
  "_catalog-state-output.txt",
);

const AXES = [
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

const lines: string[] = [];
function out(s: string): void {
  lines.push(s);
  console.log(s);
}

async function main(): Promise<void> {
  out(`Thread 2 catalog-state probe`);
  out(`Captured: ${new Date().toISOString()}`);
  out(`Shop:     ${SHOP}`);
  out("");

  // Catalog totals
  const totalProducts = await prisma.product.count({ where: { shopDomain: SHOP } });
  const activeProducts = await prisma.product.count({
    where: {
      shopDomain: SHOP,
      status: "ACTIVE",
      deletedAt: null,
      recommendationExcluded: false,
    },
  });
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
  const productsWithAvailableVariantRows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
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
  const productsWithAvailableVariant = Number(productsWithAvailableVariantRows[0]?.c ?? 0);

  out(`== Catalog totals ==`);
  out(`  Products (all):                ${totalProducts}`);
  out(`  ACTIVE+not-deleted+not-excluded: ${activeProducts}`);
  out(`  + embedding NOT NULL:            ${activeWithEmbedding}`);
  out(`  + availableForSale variant:      ${productsWithAvailableVariant}`);
  out(`  In-stock ratio: ${productsWithAvailableVariant}/${activeWithEmbedding} = ${((productsWithAvailableVariant / Math.max(1, activeWithEmbedding)) * 100).toFixed(2)}%`);
  out("");

  // === #43: gender axis state ===
  out(`== #43 gender axis state ==`);
  const genderRows = await prisma.productTag.groupBy({
    by: ["status", "value"],
    where: { shopDomain: SHOP, axis: "gender" },
    _count: { _all: true },
    orderBy: [{ status: "asc" }, { value: "asc" }],
  });
  if (genderRows.length === 0) {
    out(`  No gender ProductTag rows at all.`);
  } else {
    for (const r of genderRows) {
      out(`  status=${r.status} value=${r.value}: ${r._count._all} rows`);
    }
  }
  const genderDistinctApprovedRows = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis: "gender", status: "APPROVED" },
    distinct: ["productId"],
    select: { productId: true },
  });
  out(`  Distinct products with APPROVED gender: ${genderDistinctApprovedRows.length}`);
  const genderFemaleApprovedRows = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis: "gender", status: "APPROVED", value: "female" },
    distinct: ["productId"],
    select: { productId: true },
  });
  out(`  Distinct products with APPROVED gender=female: ${genderFemaleApprovedRows.length}`);
  out("");

  // === #45: in-stock ratio reconfirm ===
  out(`== #45 in-stock ratio reconfirm ==`);
  out(`  29 of 1,168 ACTIVE pre-mech.1? Current count: ${productsWithAvailableVariant} of ${activeWithEmbedding}`);
  // Distinct ACTIVE+embedded count (separate from the Stage 1 input proxy).
  const activeProductsCount = await prisma.product.count({
    where: {
      shopDomain: SHOP,
      status: "ACTIVE",
      deletedAt: null,
      recommendationExcluded: false,
    },
  });
  out(`  Total ACTIVE+not-deleted+not-excluded: ${activeProductsCount}`);
  out(`  In-stock subset ratio: ${productsWithAvailableVariant}/${activeProductsCount} = ${((productsWithAvailableVariant / Math.max(1, activeProductsCount)) * 100).toFixed(2)}%`);
  out("");

  // === #46: size_range AI-tagger reliability ===
  out(`== #46 size_range AI-tagger reliability ==`);
  const sizeRangeTotal = await prisma.productTag.count({
    where: { shopDomain: SHOP, axis: "size_range" },
  });
  const sizeRangeApproved = await prisma.productTag.count({
    where: { shopDomain: SHOP, axis: "size_range", status: "APPROVED" },
  });
  const sizeRangePending = await prisma.productTag.count({
    where: { shopDomain: SHOP, axis: "size_range", status: "PENDING_REVIEW" },
  });
  const sizeRangeRejected = await prisma.productTag.count({
    where: { shopDomain: SHOP, axis: "size_range", status: "REJECTED" },
  });
  out(`  Total size_range rows: ${sizeRangeTotal}`);
  out(`  APPROVED:               ${sizeRangeApproved}`);
  out(`  PENDING_REVIEW:         ${sizeRangePending}`);
  out(`  REJECTED:               ${sizeRangeRejected}`);
  const sizeRangeDistinctApproved = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis: "size_range", status: "APPROVED" },
    distinct: ["productId"],
    select: { productId: true },
  });
  out(`  Distinct products with APPROVED size_range: ${sizeRangeDistinctApproved.length}`);
  // Confidence distribution on PENDING_REVIEW rows.
  const pendingWithConfidence = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis: "size_range", status: "PENDING_REVIEW" },
    select: { confidence: true },
  });
  const sub08 = pendingWithConfidence.filter((r) => (r.confidence ?? 0) < 0.8).length;
  const total = pendingWithConfidence.length;
  out(`  PENDING_REVIEW sub-0.8 confidence: ${sub08}/${total} (${total > 0 ? ((sub08 / total) * 100).toFixed(1) : "n/a"}%)`);
  out("");

  // === #49: category coverage ===
  out(`== #49 broader category coverage ==`);
  const categoryByValue = await prisma.productTag.groupBy({
    by: ["status", "value"],
    where: { shopDomain: SHOP, axis: "category" },
    _count: { _all: true },
    orderBy: [{ value: "asc" }],
  });
  const approvedByValue = categoryByValue.filter((r) => r.status === "APPROVED");
  out(`  APPROVED category by value:`);
  let totalApprovedCategory = 0;
  for (const r of approvedByValue) {
    out(`    ${r.value.padEnd(20)} ${r._count._all}`);
    totalApprovedCategory += r._count._all;
  }
  out(`  Total APPROVED category rows: ${totalApprovedCategory}`);
  const categoryDistinctApproved = await prisma.productTag.findMany({
    where: { shopDomain: SHOP, axis: "category", status: "APPROVED" },
    distinct: ["productId"],
    select: { productId: true },
  });
  out(`  Distinct products with APPROVED category: ${categoryDistinctApproved.length}`);
  out(`  Coverage: ${categoryDistinctApproved.length}/${activeProductsCount} = ${((categoryDistinctApproved.length / Math.max(1, activeProductsCount)) * 100).toFixed(2)}%`);
  // Source split.
  const categorySourceSplit = await prisma.productTag.groupBy({
    by: ["source"],
    where: { shopDomain: SHOP, axis: "category", status: "APPROVED" },
    _count: { _all: true },
  });
  for (const r of categorySourceSplit) {
    out(`  source=${r.source}: ${r._count._all}`);
  }
  out("");

  // === Full per-axis APPROVED distinct-product summary ===
  out(`== Per-axis APPROVED distinct product count (for #43/#46/#49 context) ==`);
  for (const axis of AXES) {
    const rows = await prisma.productTag.findMany({
      where: { shopDomain: SHOP, axis, status: "APPROVED" },
      distinct: ["productId"],
      select: { productId: true },
    });
    out(`  ${axis.padEnd(20)} ${rows.length}`);
  }
  out("");

  out(`-- End probe --`);
  fs.writeFileSync(OUT_PATH, lines.join("\n"));
  console.log(`Wrote ${OUT_PATH}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
