// One-shot inspection: post-batch-1-failure state. Counts APPROVED rows
// flipped by the failed live run (`actorId='system://3.1.7-mech.3-bulk-
// approve'`), plus per-axis residual PENDING_REVIEW counts (broken into
// high-confidence ≥ 0.8 and low-confidence < 0.8 for clarity on what
// the resumed run would target).

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
const ACTOR_ID = "system://3.1.7-mech.3-bulk-approve";

async function main(): Promise<void> {
  // Audit trail from the failed run.
  const auditRows = await prisma.productTagAudit.count({
    where: { shopDomain: SHOP, actorId: ACTOR_ID },
  });
  // eslint-disable-next-line no-undef, no-console
  console.log("ProductTagAudit rows from this mech.3 run:", auditRows);

  // Currently APPROVED count from this actorId. Source: the actor wrote
  // the audit. The corresponding ProductTag rows are now status=APPROVED.
  // Use the audit-row productIds + axes to count the flipped tags.
  const auditDetails = await prisma.productTagAudit.findMany({
    where: { shopDomain: SHOP, actorId: ACTOR_ID },
    select: { productId: true, axis: true },
  });
  // eslint-disable-next-line no-undef, no-console
  console.log("Audit rows by axis:");
  const auditByAxis = new Map<string, number>();
  for (const r of auditDetails) {
    auditByAxis.set(r.axis, (auditByAxis.get(r.axis) ?? 0) + 1);
  }
  for (const ax of AXES) {
    // eslint-disable-next-line no-undef, no-console
    console.log("  " + ax.padEnd(14), auditByAxis.get(ax) ?? 0);
  }

  // eslint-disable-next-line no-undef, no-console
  console.log("\nPer-axis ProductTag status snapshot post-batch-1-failure:");
  for (const ax of AXES) {
    const grouped = await prisma.productTag.groupBy({
      by: ["status"],
      where: { shopDomain: SHOP, axis: ax },
      _count: { _all: true },
    });
    // eslint-disable-next-line no-undef, no-console
    console.log("  " + ax + ":");
    for (const row of grouped) {
      // eslint-disable-next-line no-undef, no-console
      console.log("    " + row.status + ": " + row._count._all);
    }
  }

  // Remaining high-confidence PENDING_REVIEW (what the resumed run would target).
  const remainingHigh = await prisma.productTag.count({
    where: {
      shopDomain: SHOP,
      axis: { in: AXES },
      status: "PENDING_REVIEW",
      locked: false,
      confidence: { gte: 0.8 },
    },
  });
  // eslint-disable-next-line no-undef, no-console
  console.log(
    "\nRemaining high-confidence (≥0.8) PENDING_REVIEW on the 7 axes:",
    remainingHigh,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-undef, no-console
  console.error(e);
  // eslint-disable-next-line no-undef
  process.exit(1);
});
