// PR-3.1-mech.4: Stage 3 re-rank — mode-keyed registry dispatch.
//
// Pattern (locked decision D2): Partial<Record<StoreMode, ReRankerSet>>.
// Adding a mode in Phase 5 is a single registry-line entry plus a new
// per-mode module — no conditional logic in this file changes.
//
// rerank() flow:
//   - Look up mode in the registry. Missing entry → return input
//     candidates unchanged with a contribution recording
//     fallback="no-mode-reranker". This keeps Stage 3 correct for
//     non-FASHION modes in 3.1.
//   - For each candidate, run every re-ranker in the set; record the
//     boost magnitudes keyed by re-ranker name into
//     candidate.rerankBoosts. Stage 5/6 reads this map for final
//     scoring.
//   - Stage 3 PRESERVES candidate set size (D5). No filtering, no
//     reordering — only attaches rerankBoosts.

import type { CandidateProduct, QueryAttributes, StageOutput, CustomerProfileSnapshot, StoreMode } from "../types";
import {
  FASHION_NAMED_RERANKERS,
  fashionReRankerSet,
  type NamedReRanker,
} from "./fashion.server";

const STAGE_NAME = "stage-3-rerank";

export type ReRankInput = {
  candidates: CandidateProduct[];
  queryAttributes: QueryAttributes;
  profile: CustomerProfileSnapshot | null;
};

export type ReRanker = (candidate: CandidateProduct, ctx: ReRankInput) => number;

export type ReRankerSet = {
  rerankers: ReRanker[];
  describe(): string[];
};

const RE_RANKER_REGISTRY: Partial<Record<StoreMode, ReRankerSet>> = {
  FASHION: fashionReRankerSet,
  // ELECTRONICS, FURNITURE, BEAUTY, JEWELLERY, GENERAL — Phase 5
};

// Per-mode named-reranker tuples for trace-friendly boost keying.
// The ReRankerSet exposes only the unnamed reranker functions; this
// auxiliary map preserves the names so contribution.meta + per-
// candidate rerankBoosts use stable, human-readable keys.
const NAMED_RERANKER_REGISTRY: Partial<Record<StoreMode, readonly NamedReRanker[]>> = {
  FASHION: FASHION_NAMED_RERANKERS,
};

export function rerank(input: ReRankInput, mode: StoreMode): StageOutput {
  const startMs = Date.now();
  const candidatesIn = input.candidates.length;

  const set = RE_RANKER_REGISTRY[mode];
  const named = NAMED_RERANKER_REGISTRY[mode];

  if (!set || !named) {
    return {
      candidates: input.candidates,
      contribution: {
        name: STAGE_NAME,
        ms: Date.now() - startMs,
        candidatesIn,
        candidatesOut: candidatesIn,
        meta: {
          fallback: "no-mode-reranker",
          mode,
        },
      },
    };
  }

  const out: CandidateProduct[] = input.candidates.map((c) => {
    const boosts: Record<string, number> = {};
    for (const r of named) {
      boosts[r.name] = r.rerank(c, input);
    }
    return { ...c, rerankBoosts: boosts };
  });

  return {
    candidates: out,
    contribution: {
      name: STAGE_NAME,
      ms: Date.now() - startMs,
      candidatesIn,
      candidatesOut: out.length,
      meta: {
        mode,
        queryAttributes: input.queryAttributes,
        profileApplied: input.profile != null,
        rerankerCount: named.length,
        rerankerNames: named.map((r) => r.name),
      },
    },
  };
}
