// One-shot inspection: distribution of `confidence` on PENDING_REVIEW
// rows in the seven secondary axes mech.3 will bulk-approve. Per the
// mech.3 prompt's decision gate (ProductTag has confidence Float?), if
// >5% of candidates are below 0.8 confidence we STOP and surface for
// posture reconsideration before going live.

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
  const rows = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      axis: { in: AXES },
      status: "PENDING_REVIEW",
      locked: false,
    },
    select: { axis: true, confidence: true },
  });

  // eslint-disable-next-line no-undef, no-console
  console.log("Total PENDING_REVIEW candidates:", rows.length);
  const nullConf = rows.filter((r) => r.confidence === null).length;
  const withConf = rows.filter(
    (r): r is { axis: string; confidence: number } => r.confidence !== null,
  );
  // eslint-disable-next-line no-undef, no-console
  console.log(
    "Confidence is NULL:",
    nullConf,
    `(${((100 * nullConf) / rows.length).toFixed(1)}%)`,
  );
  // eslint-disable-next-line no-undef, no-console
  console.log("Confidence is set: ", withConf.length);

  if (withConf.length > 0) {
    const sorted = withConf.map((r) => r.confidence).sort((a, b) => a - b);
    const q = (p: number): number => sorted[Math.floor(p * sorted.length)];
    // eslint-disable-next-line no-undef, no-console
    console.log(
      "  min/p25/median/p75/max:",
      sorted[0].toFixed(3),
      "/",
      q(0.25).toFixed(3),
      "/",
      q(0.5).toFixed(3),
      "/",
      q(0.75).toFixed(3),
      "/",
      sorted[sorted.length - 1].toFixed(3),
    );
    const below80 = withConf.filter((r) => r.confidence < 0.8).length;
    // eslint-disable-next-line no-undef, no-console
    console.log(
      "  below 0.8:",
      below80,
      `(${((100 * below80) / withConf.length).toFixed(1)}% of confidence-set rows; ${((100 * below80) / rows.length).toFixed(1)}% of total)`,
    );
    // eslint-disable-next-line no-undef, no-console
    console.log("  per-axis count of confidence < 0.8:");
    for (const ax of AXES) {
      const total = withConf.filter((r) => r.axis === ax).length;
      const n = withConf.filter((r) => r.axis === ax && r.confidence < 0.8)
        .length;
      // eslint-disable-next-line no-undef, no-console
      console.log("   ", ax.padEnd(14), n + "/" + total);
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
