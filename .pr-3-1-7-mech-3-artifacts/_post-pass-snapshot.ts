// Post-pass per-axis snapshot for mech.3 close. The script's AFTER
// snapshot already captures this inline; this standalone file is the
// easy-cite reference for mech.3.5 and 3.1.7 close commit.

import "dotenv/config";
import prisma from "../app/db.server";

const SHOP = "ai-fashion-store.myshopify.com";
const AXES = [
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
  console.log("Per-axis APPROVED+PENDING_REVIEW counts post-mech.3:");
  for (const axis of AXES) {
    const grouped = await prisma.productTag.groupBy({
      by: ["status"],
      where: { shopDomain: SHOP, axis },
      _count: { _all: true },
    });
    // eslint-disable-next-line no-undef, no-console
    console.log("  " + axis + ":");
    for (const row of grouped) {
      // eslint-disable-next-line no-undef, no-console
      console.log("    " + row.status + ": " + row._count._all);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-undef, no-console
  console.error(e);
  // eslint-disable-next-line no-undef
  process.exit(1);
});
