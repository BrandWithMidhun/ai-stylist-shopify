// One-shot probe: catalog-wide APPROVED + PENDING_REVIEW + REJECTED
// counts per ProductTag axis, dev-shop-scoped. Used by mech.3.5 to
// capture the post-mech.3 catalog tagging state across all nine
// supported axes (the two primary axes from 3.1's mech.6 baseline
// + the seven secondary axes mech.3 just bulk-approved).
//
// Mirrors _post-pass-snapshot.ts in shape; differs only in axis list
// and adds a distinct-product-coverage block at the bottom.

import "dotenv/config";
import prisma from "../app/db.server";

const SHOP = "ai-fashion-store.myshopify.com";
const AXES = [
  // Primary axes — approved at 3.1's mech.6 baseline:
  "gender",
  "category",
  // Secondary axes — approved at 3.1.7-mech.3:
  "occasion",
  "color_family",
  "material",
  "fit",
  "season",
  "size_range",
  "style_type",
];

async function main(): Promise<void> {
  // eslint-disable-next-line no-undef, no-console
  console.log(`Per-axis catalog tagging counts post-mech.3 (shop=${SHOP}):`);
  // eslint-disable-next-line no-undef, no-console
  console.log("");
  for (const axis of AXES) {
    const grouped = await prisma.productTag.groupBy({
      by: ["status"],
      where: { shopDomain: SHOP, axis },
      _count: { _all: true },
    });
    // eslint-disable-next-line no-undef, no-console
    console.log(`  ${axis}:`);
    if (grouped.length === 0) {
      // eslint-disable-next-line no-undef, no-console
      console.log(`    (no tags on this axis)`);
      continue;
    }
    for (const row of grouped) {
      // eslint-disable-next-line no-undef, no-console
      console.log(`    ${row.status}: ${row._count._all}`);
    }
  }
  // eslint-disable-next-line no-undef, no-console
  console.log("");

  // Distinct-product coverage per axis (how many distinct products have
  // any APPROVED tag on this axis). Useful diagnostic — tells us how
  // many products will satisfy a fixture's per-axis filter at all.
  // eslint-disable-next-line no-undef, no-console
  console.log("Distinct products with APPROVED tag per axis:");
  for (const axis of AXES) {
    const rows = await prisma.productTag.findMany({
      where: { shopDomain: SHOP, axis, status: "APPROVED" },
      distinct: ["productId"],
      select: { productId: true },
    });
    // eslint-disable-next-line no-undef, no-console
    console.log(`  ${axis}: ${rows.length}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-undef, no-console
  console.error(e);
  // eslint-disable-next-line no-undef
  process.exit(1);
});
