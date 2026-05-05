// PR-3.1-mech.5: Stage 6 of the v2 pipeline — final scoring + whyTrace
// + ProductCard formatting.
//
// finalScore formula (per locked decision D7):
//
//   similarityScore = 1 - (candidate.similarityDistance ?? 1)
//                     // pgvector cosine distance ∈ [0, 2]; converting
//                     // to similarity in [-1, 1] then floored at 0
//                     // for the score-sum. Unset distance defaults
//                     // to 1 (orthogonal) → similarity 0.
//   rerankBoostSum  = sum of candidate.rerankBoosts values
//   merchantBoost   = candidate.merchantSignals.promoted +
//                     candidate.merchantSignals.velocity
//   diversityPenalty = candidate.diversityPenalty ?? 0
//
//   finalScore      = similarityScore + rerankBoostSum + merchantBoost
//                     - diversityPenalty
//                     clamped to [0, 2.0]
//
// whyTrace generation (per locked decision D8): deterministic template
// fragment-stitching, NOT an LLM call. Fragments are assembled by
// inspecting candidate.rerankBoosts thresholds, merchantSignals, and
// similarityDistance. Fragment ordering is stable so traces stay
// audit-friendly. Fallback "relevant to your search" when no signal
// passes its threshold.
//
// ProductCard format (per locked decision D9): mirrors the legacy
// formatProductCard shape from
// app/lib/chat/tools/recommend-products.server.ts. Adds two v2-only
// fields (traceContributions + whyTrace + finalScore) that the agent's
// render path ignores; RecommendationEvent.candidates persists them
// for audit. The flip commit (post-eval-pass) swaps the agent's
// recommend_products tool registration; the wire format the agent
// sees does not change.

import type { CandidateProduct, ProductCard, StageOutput } from "./types";

const STAGE_NAME = "stage-6-output";

const FINAL_SCORE_MIN = 0;
const FINAL_SCORE_MAX = 2.0;

// whyTrace fragment thresholds. Each threshold matches the maximum
// boost magnitude its re-ranker can produce — so a fragment fires
// when the re-ranker hit its top output, not on partial overlap.
const FRAGMENT_OCCASION_THRESHOLD = 0.4;
const FRAGMENT_FIT_THRESHOLD = 0.3;
const FRAGMENT_COLOR_THRESHOLD = 0.2;
const FRAGMENT_PROMOTED_THRESHOLD = 0.2;
const FRAGMENT_SIMILARITY_THRESHOLD = 0.3;
const FRAGMENT_MAX = 2;

export type ShopMeta = {
  shopName: string;
};

function computeFinalScore(c: CandidateProduct): number {
  const distance = c.similarityDistance ?? 1;
  const similarityScore = Math.max(0, 1 - distance);
  const rerankBoostSum = c.rerankBoosts
    ? Object.values(c.rerankBoosts).reduce((s, n) => s + n, 0)
    : 0;
  const promoted = c.merchantSignals?.promoted ?? 0;
  const velocity = c.merchantSignals?.velocity ?? 0;
  const merchantBoost = promoted + velocity;
  const diversityPenalty = c.diversityPenalty ?? 0;
  const raw = similarityScore + rerankBoostSum + merchantBoost - diversityPenalty;
  return Math.max(FINAL_SCORE_MIN, Math.min(FINAL_SCORE_MAX, raw));
}

function buildWhyTrace(c: CandidateProduct, shopMeta: ShopMeta): string {
  const fragments: string[] = [];
  const boosts = c.rerankBoosts ?? {};
  const merchant = c.merchantSignals ?? {};

  if ((boosts.occasion ?? 0) >= FRAGMENT_OCCASION_THRESHOLD) {
    fragments.push("Strong occasion match");
  }
  if ((boosts.fit ?? 0) >= FRAGMENT_FIT_THRESHOLD) {
    fragments.push("fit matches your preference");
  }
  if ((boosts.color ?? 0) >= FRAGMENT_COLOR_THRESHOLD) {
    fragments.push("color matches your search");
  }
  if ((merchant.promoted ?? 0) >= FRAGMENT_PROMOTED_THRESHOLD) {
    fragments.push(`promoted by ${shopMeta.shopName}`);
  }
  const dist = c.similarityDistance ?? 1;
  if (dist < FRAGMENT_SIMILARITY_THRESHOLD) {
    fragments.push("closely matches your search");
  }

  if (fragments.length === 0) {
    fragments.push("relevant to your search");
  }
  // Cap to FRAGMENT_MAX fragments and join into 1-2 sentences. First
  // fragment's first character is capitalized as a sentence start;
  // subsequent fragments chain with ". " and keep their natural
  // lowercase casing because they read as clauses, not sentences.
  // Storing fragments lowercase-internal lets the same string serve
  // either role (head or tail) without per-fragment uppercase logic.
  const head = fragments[0];
  const headCap = head.charAt(0).toUpperCase() + head.slice(1);
  const tail = fragments.slice(1, FRAGMENT_MAX).join(". ");
  return tail ? `${headCap}. ${tail}.` : `${headCap}.`;
}

function tracksContributions(
  c: CandidateProduct,
): NonNullable<ProductCard["traceContributions"]> {
  const out: NonNullable<ProductCard["traceContributions"]> = [];
  if (c.similarityDistance !== undefined) {
    out.push({
      stage: "stage-2-semantic-retrieval",
      contribution: Math.max(0, 1 - c.similarityDistance),
    });
  }
  if (c.rerankBoosts) {
    const sum = Object.values(c.rerankBoosts).reduce((s, n) => s + n, 0);
    out.push({ stage: "stage-3-rerank", contribution: sum });
  }
  if (c.merchantSignals) {
    out.push({
      stage: "stage-4-merchant-signals",
      contribution:
        (c.merchantSignals.promoted ?? 0) + (c.merchantSignals.velocity ?? 0),
    });
  }
  if (c.diversityPenalty !== undefined) {
    out.push({
      stage: "stage-5-diversity",
      contribution: -c.diversityPenalty,
    });
  }
  return out;
}

export function formatProductCard(
  c: CandidateProduct,
  shopMeta: ShopMeta,
): ProductCard {
  const finalScore = c.finalScore ?? computeFinalScore(c);
  const whyTrace = c.whyTrace ?? buildWhyTrace(c, shopMeta);
  const tagsFlat: string[] = c.tags
    ? c.tags
        .filter((t) => t.status === "APPROVED")
        .map((t) => `${t.axis}:${t.value}`)
    : [];
  const price = c.priceMin ?? 0;
  const currency = c.currency ?? "USD";

  return {
    id: c.id,
    handle: c.handle,
    title: c.title,
    imageUrl: c.featuredImageUrl,
    price,
    compareAtPrice: null,
    currency,
    // variantId is not loaded on CandidateProduct in 3.1 (Stage 1's SQL
    // doesn't load variants per D4 of mech.2). The orchestrator (mech.6)
    // is responsible for loading the lowest-priced available variant
    // for each surviving candidate before formatting; for mech.5
    // standalone tests this stays null. The agent path (post-flip) will
    // see this populated.
    variantId: null,
    available: true,
    tags: tagsFlat,
    productUrl: `/products/${c.handle}`,
    traceContributions: tracksContributions(c),
    whyTrace,
    finalScore,
  };
}

export function stage6Output(
  stage5Candidates: CandidateProduct[],
  shopMeta: ShopMeta,
): StageOutput {
  const startMs = Date.now();
  const candidatesIn = stage5Candidates.length;

  const out: CandidateProduct[] = stage5Candidates.map((c) => {
    const finalScore = computeFinalScore(c);
    const whyTrace = buildWhyTrace(c, shopMeta);
    return { ...c, finalScore, whyTrace };
  });

  const topScore = out.length > 0 ? (out[0].finalScore ?? 0) : null;
  const bottomScore = out.length > 0
    ? (out[out.length - 1].finalScore ?? 0)
    : null;

  return {
    candidates: out,
    contribution: {
      name: STAGE_NAME,
      ms: Date.now() - startMs,
      candidatesIn,
      candidatesOut: out.length,
      meta: {
        topScore,
        bottomScore,
      },
    },
  };
}
