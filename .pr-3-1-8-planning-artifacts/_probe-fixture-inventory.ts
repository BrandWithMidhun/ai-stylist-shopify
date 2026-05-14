// Thread 3 — per-fixture probe for the ranking-vs-tag-completeness gap inventory.
//
// For each of the 12 eval fixtures: run Stages 1-5 and capture
//   - Stage 1 candidate count.
//   - Stage 2 top-50 count.
//   - Stage 5 top-6 cards: per-card APPROVED tags on each axis the fixture expects.
//   - Per-fixture: do the top-6 contain candidates that satisfy expectedTagFilters?
//   - Per-fixture: how many candidates IN THE STAGE 1 POOL satisfy expectedTagFilters?
//
// Output: .pr-3-1-8-planning-artifacts/_fixture-inventory.json
//
// Run: npx tsx --env-file=.env .pr-3-1-8-planning-artifacts/_probe-fixture-inventory.ts

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

import prisma from "../app/db.server";
import { stage1HardFilters } from "../app/lib/recommendations/v2/stage-1-hard-filters.server";
import { extractQueryAttributes } from "../app/lib/recommendations/v2/stage-3-rerank/query-extraction.server";
import { embedQuery } from "../app/lib/embeddings/voyage.server";
import { findSimilarProductsAmongCandidates } from "../app/lib/embeddings/similarity-search.server";
import { rerank } from "../app/lib/recommendations/v2/stage-3-rerank/index.server";
import { stage4MerchantSignals } from "../app/lib/recommendations/v2/stage-4-merchant-signals.server";
import { stage5Diversity } from "../app/lib/recommendations/v2/stage-5-diversity.server";
import type { CandidateProduct } from "../app/lib/recommendations/v2/types";

const SHOP = "ai-fashion-store.myshopify.com";
const MODE = "FASHION" as const;
const CANDIDATE_POOL_SIZE = 50;
const TARGET_N = 6;
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
  ".pr-3-1-8-planning-artifacts",
  "_fixture-inventory.json",
);

type Fixture = {
  fixtureKey: string;
  intent: string;
  expectedTagFilters: Record<string, string[]>;
  k: number;
};

function loadFixtures(): Fixture[] {
  const files = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")))
    .sort((a, b) => a.fixtureKey.localeCompare(b.fixtureKey));
}

async function loadAllApprovedTags(
  productIds: string[],
): Promise<Map<string, Array<{ axis: string; value: string; status: string }>>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.productTag.findMany({
    where: { productId: { in: productIds }, status: "APPROVED" },
    select: { productId: true, axis: true, value: true, status: true },
  });
  const byProduct = new Map<string, Array<{ axis: string; value: string; status: string }>>();
  for (const r of rows) {
    let bucket = byProduct.get(r.productId);
    if (!bucket) {
      bucket = [];
      byProduct.set(r.productId, bucket);
    }
    bucket.push({ axis: r.axis, value: r.value, status: r.status });
  }
  return byProduct;
}

function satisfiesFilter(
  tags: Array<{ axis: string; value: string; status: string }>,
  filter: Record<string, string[]>,
): boolean {
  for (const [axis, allowed] of Object.entries(filter)) {
    const haveValues = new Set(
      tags.filter((t) => t.status === "APPROVED" && t.axis === axis).map((t) => t.value),
    );
    let anyMatch = false;
    for (const v of allowed) {
      if (haveValues.has(v)) {
        anyMatch = true;
        break;
      }
    }
    if (!anyMatch) return false;
  }
  return true;
}

async function processFixture(fix: Fixture) {
  const queryAttributes = extractQueryAttributes(fix.intent, MODE);

  // Stage 1
  const stage1Out = await stage1HardFilters(
    { shopDomain: SHOP, intent: fix.intent },
    queryAttributes,
    MODE,
  );
  const stage1Ids = stage1Out.candidates.map((c) => c.id);

  // Load tags for ALL Stage 1 candidates (so we can count how many satisfy expectedTagFilters).
  const allTags = await loadAllApprovedTags(stage1Ids);
  const stage1Satisfying = stage1Ids.filter((id) => {
    const tags = allTags.get(id) ?? [];
    return satisfiesFilter(tags, fix.expectedTagFilters);
  });

  if (stage1Ids.length === 0) {
    return {
      fixtureKey: fix.fixtureKey,
      intent: fix.intent,
      extractedQueryAttributes: queryAttributes,
      expectedTagFilters: fix.expectedTagFilters,
      stage1Count: 0,
      stage1SatisfyingCount: 0,
      stage2Count: 0,
      stage2SatisfyingCount: 0,
      stage5Count: 0,
      stage5SatisfyingCount: 0,
      stage5SatisfyingRanks: [] as number[],
      relaxedMatchAtK: 0,
      verdict: "EMPTY_STAGE_1",
    };
  }

  // Stage 2
  const queryVector = await embedQuery(fix.intent);
  const stage2Ranked = await findSimilarProductsAmongCandidates(
    queryVector,
    stage1Ids,
    CANDIDATE_POOL_SIZE,
  );
  const stage2Ids = stage2Ranked.map((r) => r.id);
  const stage2Satisfying = stage2Ids.filter((id) => {
    const tags = allTags.get(id) ?? [];
    return satisfiesFilter(tags, fix.expectedTagFilters);
  });

  // Stage 2-5 chain
  const candidatesById = new Map(stage1Out.candidates.map((c) => [c.id, c]));
  const stage2Candidates: CandidateProduct[] = [];
  for (const r of stage2Ranked) {
    const original = candidatesById.get(r.id);
    if (!original) continue;
    stage2Candidates.push({ ...original, similarityDistance: r.distance });
  }
  const taggedStage2 = stage2Candidates.map((c) => ({
    ...c,
    tags: allTags.get(c.id) ?? [],
  }));
  const stage3Out = rerank(
    { candidates: taggedStage2, queryAttributes, profile: null },
    MODE,
  );
  const stage4Out = stage4MerchantSignals(stage3Out.candidates);
  const stage5Out = stage5Diversity(stage4Out.candidates, TARGET_N);

  // Top-6 + which satisfy
  const top6 = stage5Out.candidates.map((c, idx) => {
    const tags = c.tags ?? [];
    const satisfies = satisfiesFilter(tags, fix.expectedTagFilters);
    const perAxisCoverage: Record<string, { have: string[]; allowed: string[]; satisfies: boolean }> = {};
    for (const [axis, allowed] of Object.entries(fix.expectedTagFilters)) {
      const have = tags
        .filter((t) => t.status === "APPROVED" && t.axis === axis)
        .map((t) => t.value);
      const haveSet = new Set(have);
      const axisSatisfies = allowed.some((v) => haveSet.has(v));
      perAxisCoverage[axis] = { have, allowed, satisfies: axisSatisfies };
    }
    return {
      position: idx + 1,
      productId: c.id,
      handle: c.handle,
      similarityDistance: c.similarityDistance ?? null,
      satisfies,
      perAxisCoverage,
    };
  });
  const stage5SatisfyingCount = top6.filter((c) => c.satisfies).length;
  const stage5SatisfyingRanks = top6.filter((c) => c.satisfies).map((c) => c.position);

  // Verdict: where does the binding constraint sit?
  let verdict: string;
  if (stage1Out.candidates.length === 0) {
    verdict = "STAGE_1_EMPTY";
  } else if (stage1Satisfying.length === 0) {
    verdict = "NO_SATISFYING_IN_CATALOG_POOL";
  } else if (stage2Satisfying.length === 0) {
    verdict = "STAGE_2_NARROWING_DROPS_SATISFYING";
  } else if (stage5SatisfyingCount === 0) {
    verdict = "STAGE_5_SELECTION_MISSES_SATISFYING";
  } else if (stage5SatisfyingCount < top6.length / 2) {
    verdict = "PARTIAL_RECOVERY_POSSIBLE";
  } else {
    verdict = "OK";
  }

  return {
    fixtureKey: fix.fixtureKey,
    intent: fix.intent,
    extractedQueryAttributes: queryAttributes,
    expectedTagFilters: fix.expectedTagFilters,
    stage1Count: stage1Ids.length,
    stage1SatisfyingCount: stage1Satisfying.length,
    stage1SatisfyingProductIds: stage1Satisfying,
    stage2Count: stage2Ids.length,
    stage2SatisfyingCount: stage2Satisfying.length,
    stage2SatisfyingProductIds: stage2Satisfying,
    stage5Count: stage5Out.candidates.length,
    stage5SatisfyingCount,
    stage5SatisfyingRanks,
    top6Detail: top6,
    relaxedMatchAtK: stage5SatisfyingCount / Math.max(1, stage5Out.candidates.length),
    verdict,
  };
}

async function main(): Promise<void> {
  const fixtures = loadFixtures();
  console.log(`Loaded ${fixtures.length} fixtures`);
  const results: unknown[] = [];
  for (const fix of fixtures) {
    console.log(`Processing ${fix.fixtureKey}...`);
    try {
      const r = await processFixture(fix);
      results.push(r);
      console.log(
        `  verdict=${(r as { verdict: string }).verdict}, stage1=${(r as { stage1Count: number }).stage1Count}, stage1Sat=${(r as { stage1SatisfyingCount: number }).stage1SatisfyingCount}, stage2Sat=${(r as { stage2SatisfyingCount: number }).stage2SatisfyingCount}, top6Sat=${(r as { stage5SatisfyingCount: number }).stage5SatisfyingCount}`,
      );
    } catch (e) {
      console.error(`  error: ${(e as Error).message}`);
      results.push({ fixtureKey: fix.fixtureKey, error: (e as Error).message });
    }
  }
  fs.writeFileSync(OUT_PATH, JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
