// Thread 3 probe — load-bearing candidate-pool capture for the
// fashion-oversized-fit-kurta fixture (Stage 1 -> Stage 2 -> Stage 5).
//
// Uses production modules (no logic duplication):
//   - stage1HardFilters
//   - extractQueryAttributes
//   - findSimilarProductsAmongCandidates (Stage 2's pgvector call)
//   - embedQuery (Voyage)
//   - rerank (Stage 3)
//   - stage4MerchantSignals
//   - stage5Diversity
//   - prisma from app/db.server
//
// What it captures:
//   - Stage 1's full pool with their APPROVED tag sets on the four axes
//     fix (a) cares about: category, fit, occasion, style_type.
//   - Stage 2's top-50 (candidatePool=50) with similarityDistance.
//   - Which of the Stage 2 candidates carry APPROVED fit tag.
//   - Current Stage 3-5 top-6 result (the actual selection).
//   - The rerank boosts on each top-6 card.
//
// Read-only — no DB writes.
//
// Output: .pr-3-1-8-planning-artifacts/12-kurta-candidate-pool.json
//
// Run via:
//   npx tsx --env-file=.env .pr-3-1-8-planning-artifacts/_probe-kurta-candidates.ts

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
const INTENT = "oversized fit kurta";
const MODE = "FASHION" as const;
const CANDIDATE_POOL_SIZE = 50;
const TARGET_N = 6;
const FOCUS_AXES = ["category", "fit", "occasion", "style_type", "color_family", "material"] as const;

const OUT_PATH = path.join(
  process.cwd(),
  ".pr-3-1-8-planning-artifacts",
  "12-kurta-candidate-pool.json",
);

type ApprovedTagsByProduct = Record<string, Record<string, string[]>>;

async function loadApprovedTagsForProducts(
  productIds: string[],
  axes: readonly string[],
): Promise<ApprovedTagsByProduct> {
  if (productIds.length === 0) return {};
  const rows = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      productId: { in: productIds },
      status: "APPROVED",
      axis: { in: axes as string[] },
    },
    select: { productId: true, axis: true, value: true },
  });
  const out: ApprovedTagsByProduct = {};
  for (const r of rows) {
    if (!out[r.productId]) out[r.productId] = {};
    if (!out[r.productId][r.axis]) out[r.productId][r.axis] = [];
    out[r.productId][r.axis].push(r.value);
  }
  return out;
}

// Reload tags-all-axes onto candidates for Stage 3-5 (these need full tags
// to run reranks + jaccard).
async function loadAndAttachAllApprovedTags(
  candidates: CandidateProduct[],
): Promise<CandidateProduct[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  const rows = await prisma.productTag.findMany({
    where: { productId: { in: ids }, status: "APPROVED" },
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
  return candidates.map((c) => ({ ...c, tags: byProduct.get(c.id) ?? [] }));
}

async function main(): Promise<void> {
  console.log(`Probing kurta candidates: intent="${INTENT}", shop=${SHOP}`);
  const queryAttributes = extractQueryAttributes(INTENT, MODE);
  console.log(`Extracted queryAttributes: ${JSON.stringify(queryAttributes)}`);

  // Stage 1
  const stage1Out = await stage1HardFilters(
    { shopDomain: SHOP, intent: INTENT },
    queryAttributes,
    MODE,
  );
  const stage1Candidates = stage1Out.candidates;
  console.log(`Stage 1: ${stage1Candidates.length} candidates`);

  // Per-candidate focus-axis APPROVED tags (the load-bearing data).
  const stage1Ids = stage1Candidates.map((c) => c.id);
  const focusTags = await loadApprovedTagsForProducts(stage1Ids, FOCUS_AXES);

  // Which Stage 1 candidates have APPROVED fit?
  const stage1WithFit = stage1Ids.filter(
    (id) => (focusTags[id]?.fit ?? []).length > 0,
  );
  console.log(`Stage 1: ${stage1WithFit.length} of ${stage1Ids.length} carry APPROVED fit`);

  // Stage 2: real Voyage embedQuery + pgvector ranking.
  const queryVector = await embedQuery(INTENT);
  console.log(`Stage 2: queryVector dim=${queryVector.length}`);
  const stage2Ranked = await findSimilarProductsAmongCandidates(
    queryVector,
    stage1Ids,
    CANDIDATE_POOL_SIZE,
  );
  console.log(`Stage 2: ${stage2Ranked.length} candidates in pool (cap ${CANDIDATE_POOL_SIZE})`);

  // Find the rank positions of the fit-tagged candidates in Stage 2's ordering.
  const fitCandidateRankings: Array<{ productId: string; rankInStage2: number; distance: number }> = [];
  stage2Ranked.forEach((r, idx) => {
    if (stage1WithFit.includes(r.id)) {
      fitCandidateRankings.push({ productId: r.id, rankInStage2: idx + 1, distance: r.distance });
    }
  });
  console.log(`Stage 2: fit-tagged candidate rankings = ${JSON.stringify(fitCandidateRankings)}`);

  // Build Stage 2 output as CandidateProduct[] for downstream stages.
  const candidatesById = new Map(stage1Candidates.map((c) => [c.id, c]));
  const stage2Candidates: CandidateProduct[] = [];
  for (const r of stage2Ranked) {
    const original = candidatesById.get(r.id);
    if (!original) continue;
    stage2Candidates.push({ ...original, similarityDistance: r.distance });
  }

  // Stage 2.5: tag load
  const taggedStage2 = await loadAndAttachAllApprovedTags(stage2Candidates);

  // Stage 3: rerank (attaches rerankBoosts)
  const stage3Out = rerank(
    { candidates: taggedStage2, queryAttributes, profile: null },
    MODE,
  );

  // Stage 4: merchant signals
  const stage4Out = stage4MerchantSignals(stage3Out.candidates);

  // Stage 5: diversity (selects top-N)
  const stage5Out = stage5Diversity(stage4Out.candidates, TARGET_N);
  console.log(`Stage 5: ${stage5Out.candidates.length} candidates selected`);

  // Capture the top-6 with their tags + boosts.
  const top6 = stage5Out.candidates.map((c, idx) => {
    const fitTags = (c.tags ?? [])
      .filter((t) => t.status === "APPROVED" && t.axis === "fit")
      .map((t) => t.value);
    const categoryTags = (c.tags ?? [])
      .filter((t) => t.status === "APPROVED" && t.axis === "category")
      .map((t) => t.value);
    return {
      position: idx + 1,
      productId: c.id,
      handle: c.handle,
      title: c.title,
      similarityDistance: c.similarityDistance ?? null,
      similarityScore:
        c.similarityDistance != null ? Math.max(0, 1 - c.similarityDistance) : null,
      rerankBoosts: c.rerankBoosts ?? {},
      diversityPenalty: c.diversityPenalty ?? null,
      categoryApproved: categoryTags,
      fitApproved: fitTags,
      satisfiesKurta: categoryTags.includes("kurta"),
      satisfiesFitRelaxedOrOversized:
        fitTags.includes("oversized") || fitTags.includes("relaxed"),
    };
  });

  // Pre-mech.4 candidate identification: which Stage 1 candidates are AI-tagged (not from rule-engine)?
  // The 2 original AI-tagged products that survived pre-mech.4. We can check by source on ProductTag.
  const aiTaggedKurtaProducts = await prisma.productTag.findMany({
    where: {
      shopDomain: SHOP,
      status: "APPROVED",
      axis: "category",
      value: "kurta",
      source: "AI",
    },
    select: { productId: true },
  });
  const aiKurtaIds = new Set(aiTaggedKurtaProducts.map((r) => r.productId));
  const ruleKurtaIds = stage1Ids.filter((id) => !aiKurtaIds.has(id));

  // For each Stage 2 candidate, capture its source attribution + key tags.
  const stage2Detailed = stage2Ranked.map((r, idx) => ({
    rank: idx + 1,
    productId: r.id,
    distance: r.distance,
    similarityScore: Math.max(0, 1 - r.distance),
    source: aiKurtaIds.has(r.id) ? "AI" : "RULE",
    approvedTagsOnFocusAxes: focusTags[r.id] ?? {},
    hasFitApproved: (focusTags[r.id]?.fit ?? []).length > 0,
  }));

  const out = {
    capturedAt: new Date().toISOString(),
    fixture: "fashion-oversized-fit-kurta",
    intent: INTENT,
    extractedQueryAttributes: queryAttributes,
    shop: SHOP,
    stage1: {
      totalCandidates: stage1Candidates.length,
      candidatesWithFitApproved: stage1WithFit.length,
      candidatesByCategorySource: {
        AI: aiKurtaIds.size,
        RULE: ruleKurtaIds.length,
      },
    },
    stage2: {
      candidatePoolSize: CANDIDATE_POOL_SIZE,
      candidatesInPool: stage2Ranked.length,
      fitTaggedCandidateRankings: fitCandidateRankings,
      candidates: stage2Detailed,
    },
    stage5: {
      targetN: TARGET_N,
      selectedCount: stage5Out.candidates.length,
      top6,
      satisfyingKurtaCount: top6.filter((c) => c.satisfiesKurta).length,
      satisfyingFitCount: top6.filter((c) => c.satisfiesFitRelaxedOrOversized).length,
      satisfyingBothCount: top6.filter(
        (c) => c.satisfiesKurta && c.satisfiesFitRelaxedOrOversized,
      ).length,
      relaxedMatchAtK:
        top6.filter((c) => c.satisfiesKurta && c.satisfiesFitRelaxedOrOversized).length /
        TARGET_N,
    },
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_PATH}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
