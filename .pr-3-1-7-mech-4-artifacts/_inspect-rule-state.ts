import "dotenv/config";
import prisma from "../app/db.server";

const SHOP = "ai-fashion-store.myshopify.com";

async function main(): Promise<void> {
  // What rules does the dev shop have right now?
  const rules = await prisma.taggingRule.findMany({
    where: { shopDomain: SHOP },
    orderBy: { priority: "asc" },
    select: {
      id: true,
      name: true,
      enabled: true,
      priority: true,
      effects: true,
      createdAt: true,
    },
  });
  console.log("=== TaggingRule rows on dev shop ===");
  console.log("Total rules:", rules.length);
  for (const r of rules) {
    console.log(
      `  ${r.priority} ${r.enabled ? "[on] " : "[OFF]"} ${r.name} (id=${r.id})`,
    );
    console.log(`    effects: ${JSON.stringify(r.effects)}`);
    console.log(`    createdAt: ${r.createdAt.toISOString()}`);
  }

  // What are the category APPROVED tag values distributed?
  console.log("\n=== ProductTag where axis=category, status=APPROVED ===");
  const byValue = await prisma.productTag.groupBy({
    by: ["value", "source"],
    where: { shopDomain: SHOP, axis: "category", status: "APPROVED" },
    _count: { _all: true },
    orderBy: { value: "asc" },
  });
  for (const row of byValue) {
    console.log(`  value=${row.value} source=${row.source} count=${row._count._all}`);
  }

  // Audit trail from mech.4's actorId
  console.log("\n=== ProductTagAudit rows from mech.4 ===");
  const auditRows = await prisma.productTagAudit.count({
    where: {
      shopDomain: SHOP,
      actorId: "system://3.1.7-mech.4-apply-rules",
    },
  });
  console.log(`Total mech.4 audit rows: ${auditRows}`);
  const auditByAxis = await prisma.productTagAudit.groupBy({
    by: ["axis", "newValue"],
    where: {
      shopDomain: SHOP,
      actorId: "system://3.1.7-mech.4-apply-rules",
    },
    _count: { _all: true },
  });
  for (const row of auditByAxis) {
    console.log(
      `  axis=${row.axis} newValue=${row.newValue} count=${row._count._all}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
