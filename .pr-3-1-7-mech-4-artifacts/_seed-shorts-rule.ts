import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// One-off DB insert for the "Shorts category" rule on the dev shop.
// seedRules() bails when any rule exists for a shop (rule-seeds.ts:374
// `if (existing > 0) return { created: 0, skipped: true }`), and the dev
// shop already has 7 seeded FASHION rules from earlier onboarding. This
// script adds the new rule directly to the dev shop's TaggingRule table.
// Idempotent: re-runs are no-ops once the rule exists.
//
// Future FASHION shops onboarded post-mech.4 get the rule automatically
// via SEED_RULES.FASHION (the canonical addition lives in rule-seeds.ts).

const prisma = new PrismaClient();
const SHOP = "ai-fashion-store.myshopify.com";

async function main(): Promise<void> {
  const existing = await prisma.taggingRule.findFirst({
    where: { shopDomain: SHOP, name: "Shorts category" },
  });
  if (existing) {
    console.log(
      `Rule "Shorts category" already exists (id=${existing.id} priority=${existing.priority}). No-op.`,
    );
    await prisma.$disconnect();
    return;
  }

  // Sort the new rule after existing seeds (priority 100..106 from
  // seedRules' i+100 convention). +1 keeps it at the tail.
  const maxPriority = await prisma.taggingRule.aggregate({
    where: { shopDomain: SHOP },
    _max: { priority: true },
  });
  const newPriority = (maxPriority._max.priority ?? 100) + 1;

  const created = await prisma.taggingRule.create({
    data: {
      shopDomain: SHOP,
      name: "Shorts category",
      description:
        "Maps shorts-titled or shorts-typed products to category=shorts (mech.4 D2, 3.1.7)",
      enabled: true,
      priority: newPriority,
      conditions: {
        kind: "any",
        conditions: [
          { kind: "title_contains", value: "shorts" },
          { kind: "type_equals", value: "shorts" },
          { kind: "type_equals", value: "men's shorts" },
          { kind: "type_equals", value: "women's shorts" },
          { kind: "type_equals", value: "kids shorts" },
        ],
      },
      effects: [{ axis: "category", value: "shorts" }],
    },
  });
  console.log(`Created rule id=${created.id} priority=${created.priority}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
