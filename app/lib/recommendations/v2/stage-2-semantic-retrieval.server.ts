// PR-3.1-mech.3: Stage 2 of the v2 recommendation pipeline — semantic
// retrieval via pgvector cosine over the Stage 1 narrowed candidate set.
//
// Input shape:
//   - stage1Candidates: CandidateProduct[] from Stage 1 (mech.2). Stage
//     1 already enforced shopDomain / status / deletedAt /
//     recommendationExcluded / embedding-not-null / available-variant
//     EXISTS, so this stage trusts the input set.
//   - queryVector: 1024-dim embedding of the user intent. Computed
//     once per pipeline run by the orchestrator (mech.6) via voyage's
//     embedQuery — Stage 2 does NOT call Voyage. Keeps the stage
//     pure-DB-side and easily mockable.
//   - candidatePoolSize: top-N to retrieve. Default 50 / max 100; the
//     orchestrator clamps the input value before calling. Stage 2
//     trusts the caller and passes through to the SQL LIMIT.
//
// Output: CandidateProduct[] reordered by cosine distance ascending,
// each with `similarityDistance` populated. Empty input short-circuits
// without invoking the DB helper — saves a roundtrip and keeps tests
// hermetic.
//
// contribution.meta carries:
//   - topDistance: smallest distance in the result set, or null when
//     the set is empty. Mirrors the value the legacy recommend_products
//     tool already logs at app/lib/chat/tools/recommend-products.server.ts
//     so production-vs-v2 comparisons during the flip-commit eval stay
//     apples-to-apples.
//   - candidatePoolSize: the LIMIT value the helper was asked to honor.
//   - candidatePoolInputSize: stage1Candidates.length, lets the mech.6
//     integration test verify Stage 1 → Stage 2 narrowing.

import { findSimilarProductsAmongCandidates } from "../../embeddings/similarity-search.server";
import type { CandidateProduct, StageOutput } from "./types";

const STAGE_NAME = "stage-2-semantic-retrieval";

export async function stage2SemanticRetrieval(
  stage1Candidates: CandidateProduct[],
  queryVector: number[],
  candidatePoolSize: number,
): Promise<StageOutput> {
  const startMs = Date.now();

  if (stage1Candidates.length === 0) {
    return {
      candidates: [],
      contribution: {
        name: STAGE_NAME,
        ms: Date.now() - startMs,
        candidatesIn: 0,
        candidatesOut: 0,
        meta: {
          topDistance: null,
          candidatePoolSize,
          candidatePoolInputSize: 0,
        },
      },
    };
  }

  const candidateIds = stage1Candidates.map((c) => c.id);
  const ranked = await findSimilarProductsAmongCandidates(
    queryVector,
    candidateIds,
    candidatePoolSize,
  );

  // Distance lookup keyed on candidate ID. The helper's return order
  // (cosine ASC) is what callers depend on for ranking.
  const distanceById = new Map<string, number>();
  for (const r of ranked) distanceById.set(r.id, r.distance);

  // Original CandidateProduct lookup so we don't lose Stage 1's
  // populated fields (recommendationPromoted, priceMin/Max, etc.).
  const candidateById = new Map<string, CandidateProduct>();
  for (const c of stage1Candidates) candidateById.set(c.id, c);

  // Re-iterate in helper-order — distance ASC. Defensive: truncate to
  // candidatePoolSize even though the SQL LIMIT already enforces it.
  const ordered: CandidateProduct[] = [];
  for (const r of ranked) {
    const original = candidateById.get(r.id);
    if (!original) continue;
    ordered.push({
      ...original,
      similarityDistance: r.distance,
    });
    if (ordered.length >= candidatePoolSize) break;
  }

  const ms = Date.now() - startMs;
  const topDistance = ordered.length > 0
    ? (ordered[0].similarityDistance ?? null)
    : null;

  return {
    candidates: ordered,
    contribution: {
      name: STAGE_NAME,
      ms,
      candidatesIn: stage1Candidates.length,
      candidatesOut: ordered.length,
      meta: {
        topDistance,
        candidatePoolSize,
        candidatePoolInputSize: stage1Candidates.length,
      },
    },
  };
}
