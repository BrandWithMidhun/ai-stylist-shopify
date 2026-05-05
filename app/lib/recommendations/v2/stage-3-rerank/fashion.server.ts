// PR-3.1-mech.4: FASHION re-rankers for Stage 3.
//
// Each re-ranker is a pure scored function (NOT an LLM call) that takes
// a CandidateProduct + ReRankInput context and returns an additive
// boost in [0, weight]. Re-rankers never penalize — Stage 3 only
// reorders by adding boosts; filtering / penalizing is Stage 5's job.
//
// Re-rankers read candidate.tags filtered to status='APPROVED'. The
// orchestrator (mech.6) is responsible for populating candidate.tags
// between Stage 2 and Stage 3 via a Prisma findMany. When tags is
// undefined (e.g. mech.4 unit tests, or a product with no APPROVED
// tags yet), all re-rankers gracefully return 0 — no boost, no crash.
//
// Weights per locked decision D3:
//   occasion    0.4
//   fit         0.3
//   color       0.2
//   body_type   0.15
//
// Body-type re-ranker reads profile.bodyType directly (no query
// extraction equivalent for body type — it's profile-only). When
// profile.bodyType is undefined, returns 0 for every candidate. PR-D
// D.3 verifier confirmed dev shop has 0 CustomerProfileAttribute rows
// in 3.1, so this re-ranker is a no-op in the current eval baseline.
// Phase 6's quiz integration populates profile data; the re-ranker
// activates without code change at that point.
//
// Body-type → fit affinity map vocabulary check: "slim", "regular",
// "relaxed", "oversized", "tailored" are the AXIS_OPTIONS.FASHION.fit
// values. Affinity rules below pick from this set only — proposals
// like "A-line" or "structured" (which appear in body-typing
// literature) are intentionally not used because they aren't in the
// vocabulary.

import type { CandidateProduct } from "../types";
import type { ReRanker, ReRankerSet, ReRankInput } from "./index.server";

const OCCASION_WEIGHT = 0.4;
const FIT_WEIGHT = 0.3;
const COLOR_WEIGHT = 0.2;
const BODY_TYPE_WEIGHT = 0.15;

// AXIS_OPTIONS.FASHION.fit = ["slim", "regular", "relaxed", "oversized",
// "tailored"]. Affinity entries are subsets thereof.
const BODY_TYPE_TO_FIT: Record<string, readonly string[]> = {
  apple: ["relaxed", "oversized"],
  pear: ["relaxed"],
  hourglass: ["tailored", "slim"],
  rectangle: ["tailored"],
  inverted_triangle: ["relaxed"],
};

function approvedValuesFor(
  candidate: CandidateProduct,
  axis: string,
): string[] {
  if (!candidate.tags) return [];
  const out: string[] = [];
  for (const t of candidate.tags) {
    if (t.status === "APPROVED" && t.axis === axis) out.push(t.value);
  }
  return out;
}

const occasionReRanker: ReRanker = (candidate, ctx) => {
  const queryOccasions = ctx.queryAttributes.occasion ?? [];
  if (queryOccasions.length === 0) return 0;
  if (!candidate.tags) return 0;
  const candValues = approvedValuesFor(candidate, "occasion");
  if (candValues.length === 0) return 0;
  const overlap = queryOccasions.filter((v) => candValues.includes(v)).length;
  return OCCASION_WEIGHT * (overlap / Math.max(1, queryOccasions.length));
};

const fitReRanker: ReRanker = (candidate, ctx) => {
  const queryFits = ctx.queryAttributes.fit ?? [];
  if (queryFits.length === 0) return 0;
  if (!candidate.tags) return 0;
  const candValues = approvedValuesFor(candidate, "fit");
  if (candValues.length === 0) return 0;
  const matches = queryFits.some((v) => candValues.includes(v));
  return matches ? FIT_WEIGHT : 0;
};

const colorReRanker: ReRanker = (candidate, ctx) => {
  const queryColors = ctx.queryAttributes.color_family ?? [];
  if (queryColors.length === 0) return 0;
  if (!candidate.tags) return 0;
  const candValues = approvedValuesFor(candidate, "color_family");
  if (candValues.length === 0) return 0;
  const overlap = queryColors.filter((v) => candValues.includes(v)).length;
  return COLOR_WEIGHT * (overlap / Math.max(1, queryColors.length));
};

const bodyTypeReRanker: ReRanker = (candidate, ctx) => {
  const bodyType = ctx.profile?.bodyType;
  if (!bodyType) return 0;
  const affinityFits = BODY_TYPE_TO_FIT[bodyType];
  if (!affinityFits || affinityFits.length === 0) return 0;
  if (!candidate.tags) return 0;
  const candFits = approvedValuesFor(candidate, "fit");
  if (candFits.length === 0) return 0;
  const matches = candFits.some((f) => affinityFits.includes(f));
  return matches ? BODY_TYPE_WEIGHT : 0;
};

// Named-export tuple so the registry can iterate in a fixed order
// and the trace records boost-name → magnitude pairs deterministically.
export type NamedReRanker = { name: string; rerank: ReRanker };

export const FASHION_NAMED_RERANKERS: readonly NamedReRanker[] = [
  { name: "occasion", rerank: occasionReRanker },
  { name: "fit", rerank: fitReRanker },
  { name: "color", rerank: colorReRanker },
  { name: "body_type", rerank: bodyTypeReRanker },
];

export const fashionReRankerSet: ReRankerSet = {
  rerankers: FASHION_NAMED_RERANKERS.map((r) => r.rerank),
  describe(): string[] {
    return FASHION_NAMED_RERANKERS.map((r) => r.name);
  },
};

// Direct exports for unit-testing individual re-rankers.
export {
  occasionReRanker,
  fitReRanker,
  colorReRanker,
  bodyTypeReRanker,
  BODY_TYPE_TO_FIT,
};

// Re-export ReRankInput so test files can import the input shape from
// either index.server.ts or fashion.server.ts.
export type { ReRankInput };
