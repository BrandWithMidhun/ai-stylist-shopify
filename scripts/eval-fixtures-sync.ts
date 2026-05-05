// PR-3.1-mech.1: sync the v2 eval fixture JSON files into EvalQuery rows.
//
// Fixtures-on-disk are the source of truth; the DB is a queryable cache
// that the runner pulls from. This script idempotently upserts every
// app/lib/recommendations/v2/eval/fixtures/*.json into the DB keyed by
// (shopDomain, fixtureKey).
//
// Usage:
//   npx tsx scripts/eval-fixtures-sync.ts
//   npx tsx scripts/eval-fixtures-sync.ts --shop=ai-fashion-store.myshopify.com
//
// Re-runs are safe: existing rows update in place, new rows insert.
// Removed-from-disk fixtures are NOT auto-deleted (deliberate — a typo
// in a JSON filename should never silently delete a row that another
// EvalRun references via FK).

import * as fs from "node:fs";
import * as path from "node:path";
import prisma from "../app/db.server";

const DEFAULT_SHOP = "ai-fashion-store.myshopify.com";
const FIXTURES_DIR = path.join(
  process.cwd(),
  "app",
  "lib",
  "recommendations",
  "v2",
  "eval",
  "fixtures",
);

type FixtureFile = {
  fixtureKey: string;
  mode: "FASHION" | "ELECTRONICS" | "FURNITURE" | "BEAUTY" | "JEWELLERY" | "GENERAL";
  intent: string;
  expectedHandles: string[];
  expectedTagFilters: Record<string, string[]>;
  k?: number;
  notes?: string;
};

function parseShopArg(): string {
  const arg = process.argv.find((a) => a.startsWith("--shop="));
  if (arg) return arg.slice("--shop=".length).trim() || DEFAULT_SHOP;
  return DEFAULT_SHOP;
}

async function main(): Promise<void> {
  const shopDomain = parseShopArg();

  if (!fs.existsSync(FIXTURES_DIR)) {
    // eslint-disable-next-line no-console
    console.error(`fixtures dir not found: ${FIXTURES_DIR}`);
    process.exit(2);
  }
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  if (files.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`no fixture JSON files in ${FIXTURES_DIR}`);
    process.exit(2);
  }

  let upserted = 0;
  for (const file of files) {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), "utf-8");
    let fixture: FixtureFile;
    try {
      fixture = JSON.parse(raw) as FixtureFile;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[eval-fixtures-sync] invalid JSON in ${file}:`, err);
      process.exit(1);
    }
    if (!fixture.fixtureKey || !fixture.mode || !fixture.intent) {
      // eslint-disable-next-line no-console
      console.error(
        `[eval-fixtures-sync] ${file} is missing required fields (fixtureKey/mode/intent)`,
      );
      process.exit(1);
    }
    await prisma.evalQuery.upsert({
      where: {
        shopDomain_fixtureKey: {
          shopDomain,
          fixtureKey: fixture.fixtureKey,
        },
      },
      create: {
        shopDomain,
        fixtureKey: fixture.fixtureKey,
        mode: fixture.mode,
        intent: fixture.intent,
        expectedHandles: fixture.expectedHandles ?? [],
        expectedTagFilters: fixture.expectedTagFilters ?? {},
        k: fixture.k ?? 6,
        notes: fixture.notes ?? null,
      },
      update: {
        mode: fixture.mode,
        intent: fixture.intent,
        expectedHandles: fixture.expectedHandles ?? [],
        expectedTagFilters: fixture.expectedTagFilters ?? {},
        k: fixture.k ?? 6,
        notes: fixture.notes ?? null,
      },
    });
    upserted += 1;
    // eslint-disable-next-line no-console
    console.log(`  upserted: ${fixture.fixtureKey}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\n${upserted} fixtures synced for shop ${shopDomain}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[eval-fixtures-sync] failed:", err);
  process.exit(1);
});
