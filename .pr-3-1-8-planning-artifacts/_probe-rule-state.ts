// Thread 2 probe — TaggingRule state for op debt #51.
//
// Reconfirms the dev shop's TaggingRule divergence from SEED_RULES.FASHION
// (mech.4.5 finding). Lists all rules in priority order with their effects.
//
// Output: .pr-3-1-8-planning-artifacts/_rule-state-output.txt
//
// Run: npx tsx --env-file=.env .pr-3-1-8-planning-artifacts/_probe-rule-state.ts

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import prisma from "../app/db.server";
import { SEED_RULES } from "../app/lib/catalog/rule-seeds";

const SHOP = "ai-fashion-store.myshopify.com";

const OUT_PATH = path.join(
  process.cwd(),
  ".pr-3-1-8-planning-artifacts",
  "_rule-state-output.txt",
);

const lines: string[] = [];
function out(s: string): void {
  lines.push(s);
  console.log(s);
}

async function main(): Promise<void> {
  out(`Thread 2 rule-state probe`);
  out(`Captured: ${new Date().toISOString()}`);
  out(`Shop:     ${SHOP}`);
  out("");

  // Pull all TaggingRule rows for the shop.
  const rules = await prisma.taggingRule.findMany({
    where: { shopDomain: SHOP },
    orderBy: { priority: "asc" },
    select: {
      id: true,
      name: true,
      priority: true,
      conditions: true,
      effects: true,
      createdAt: true,
    },
  });
  out(`== Dev-shop TaggingRule rows: ${rules.length} total ==`);
  for (const r of rules) {
    out(`  priority=${r.priority} name="${r.name}"`);
    out(`    conditions: ${JSON.stringify(r.conditions)}`);
    out(`    effects:    ${JSON.stringify(r.effects)}`);
    out(`    createdAt:  ${r.createdAt.toISOString()}`);
  }
  out("");

  // Compare against SEED_RULES.FASHION codebase definition.
  const seedRules = SEED_RULES.FASHION;
  out(`== SEED_RULES.FASHION rules: ${seedRules.length} total ==`);
  for (const r of seedRules) {
    out(`  name="${r.name}"`);
    out(`    conditions: ${JSON.stringify(r.conditions)}`);
    out(`    effects:    ${JSON.stringify(r.effects)}`);
  }
  out("");

  // Compute divergence:
  // 1) rules in dev shop NOT in SEED_RULES (by name)
  // 2) rules in SEED_RULES NOT in dev shop (by name)
  const shopRuleNames = new Set(rules.map((r) => r.name));
  const seedRuleNames = new Set(seedRules.map((r) => r.name));
  out(`== Divergence summary ==`);
  const onlyInShop = rules.filter((r) => !seedRuleNames.has(r.name)).map((r) => r.name);
  const onlyInSeed = seedRules.filter((r) => !shopRuleNames.has(r.name)).map((r) => r.name);
  out(`  Rules ONLY in dev shop (not in SEED_RULES.FASHION):`);
  if (onlyInShop.length === 0) out(`    (none)`);
  else for (const n of onlyInShop) out(`    - ${n}`);
  out(`  Rules ONLY in SEED_RULES.FASHION (not in dev shop):`);
  if (onlyInSeed.length === 0) out(`    (none)`);
  else for (const n of onlyInSeed) out(`    - ${n}`);
  out("");

  // Per-effect-axis comparison
  out(`== Effect-axis comparison ==`);
  out(`  Dev-shop rule effect-axes:`);
  const shopAxes: Record<string, string[]> = {};
  for (const r of rules) {
    const effects = r.effects as Array<{ axis: string; value: unknown }>;
    for (const e of effects) {
      if (!shopAxes[e.axis]) shopAxes[e.axis] = [];
      shopAxes[e.axis].push(`${r.name} → ${e.axis}=${JSON.stringify(e.value)}`);
    }
  }
  for (const axis of Object.keys(shopAxes).sort()) {
    out(`    ${axis}:`);
    for (const line of shopAxes[axis]) out(`      - ${line}`);
  }
  out(`  SEED_RULES.FASHION rule effect-axes:`);
  const seedAxes: Record<string, string[]> = {};
  for (const r of seedRules) {
    for (const e of r.effects) {
      if (!seedAxes[e.axis]) seedAxes[e.axis] = [];
      seedAxes[e.axis].push(`${r.name} → ${e.axis}=${JSON.stringify(e.value)}`);
    }
  }
  for (const axis of Object.keys(seedAxes).sort()) {
    out(`    ${axis}:`);
    for (const line of seedAxes[axis]) out(`      - ${line}`);
  }
  out("");

  // Audit trail intentionally omitted — no TaggingRuleAudit model exists.
  // Audit context for these rules is in `.pr-3-1-7-mech-4-artifacts/_inspect-rule-state-output.txt`.
  out(`== Audit note ==`);
  out(`  TaggingRuleAudit model does not exist; rule provenance for the 6 pre-mech.4 rules is unknown.`);
  out(`  The Shorts category rule (priority 106, createdAt 2026-05-11) was created by mech.4.`);
  out(`  The other 6 rules were already in place before 3.1.7 (pre-mech.4); origin is undocumented.`);

  fs.writeFileSync(OUT_PATH, lines.join("\n"));
  console.log(`Wrote ${OUT_PATH}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
