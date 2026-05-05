// PR-3.1-mech.4: FASHION re-ranker + registry-dispatch tests.
//
// Direct imports — all re-rankers are pure functions taking
// (candidate, ctx). No DB / LLM mocks needed.
//
// Seven tests per spec D2 + D3:
//   - Occasion re-ranker: full-overlap (boost 0.4) + partial-overlap
//     (0.4 × 1/2 = 0.2).
//   - Fit re-ranker: profile.fitPreference path (0.3) and
//     queryAttributes.fit path (0.3).
//   - Color re-ranker: full match (0.2).
//   - Body-type: profile.bodyType=null is no-op (0). With bodyType=
//     "apple" + candidate fit="oversized": 0.15.
//   - Sum-of-boosts via rerank() registry call: all four matches →
//     rerankBoosts = { occasion: 0.4, fit: 0.3, color: 0.2,
//     body_type: 0.15 }, sum 1.05.
//   - Graceful degradation: candidate.tags undefined → all four
//     re-rankers return 0.
//   - Registry dispatch: rerank() with mode="ELECTRONICS" returns
//     candidates unchanged with fallback meta.

import { describe, expect, it } from "vitest";
import {
  bodyTypeReRanker,
  colorReRanker,
  fitReRanker,
  occasionReRanker,
  type ReRankInput,
} from "./fashion.server";
import { rerank } from "./index.server";
import type {
  CandidateProduct,
  CustomerProfileSnapshot,
  QueryAttributes,
} from "../types";

function makeCandidate(
  id: string,
  tags?: Array<{ axis: string; value: string; status?: string }>,
): CandidateProduct {
  return {
    id,
    handle: `handle-${id}`,
    title: `Title ${id}`,
    productType: "shirt",
    vendor: "TestVendor",
    featuredImageUrl: null,
    priceMin: 100,
    priceMax: 200,
    currency: "USD",
    recommendationPromoted: false,
    recommendationExcluded: false,
    tags: tags?.map((t) => ({ ...t, status: t.status ?? "APPROVED" })),
  };
}

function ctx(
  qa: QueryAttributes,
  profile: CustomerProfileSnapshot | null = null,
  candidates: CandidateProduct[] = [],
): ReRankInput {
  return { candidates, queryAttributes: qa, profile };
}

describe("occasionReRanker", () => {
  it("full overlap → 0.4 (1/1)", () => {
    const c = makeCandidate("a", [{ axis: "occasion", value: "casual" }]);
    const boost = occasionReRanker(c, ctx({ occasion: ["casual"] }));
    expect(boost).toBeCloseTo(0.4, 5);
  });

  it("partial overlap → 0.4 × (1/2) = 0.2", () => {
    const c = makeCandidate("a", [{ axis: "occasion", value: "casual" }]);
    const boost = occasionReRanker(c, ctx({ occasion: ["casual", "work"] }));
    expect(boost).toBeCloseTo(0.2, 5);
  });
});

describe("fitReRanker", () => {
  it("queryAttributes.fit match → 0.3 (binary)", () => {
    const c = makeCandidate("a", [{ axis: "fit", value: "oversized" }]);
    const boost = fitReRanker(c, ctx({ fit: ["oversized"] }));
    expect(boost).toBeCloseTo(0.3, 5);
  });

  it("profile.fitPreference flows through query-extraction; the re-ranker reads the merged queryAttributes.fit and boosts 0.3", () => {
    // At pipeline runtime, query-extraction overwrites
    // queryAttributes.fit with profile.fitPreference. The re-ranker
    // reads queryAttributes.fit only — testing that path here.
    const c = makeCandidate("a", [{ axis: "fit", value: "oversized" }]);
    const profile: CustomerProfileSnapshot = { fitPreference: "oversized" };
    const boost = fitReRanker(c, ctx({ fit: ["oversized"] }, profile));
    expect(boost).toBeCloseTo(0.3, 5);
  });
});

describe("colorReRanker", () => {
  it("full overlap → 0.2 (1/1)", () => {
    const c = makeCandidate("a", [
      { axis: "color_family", value: "white" },
    ]);
    const boost = colorReRanker(c, ctx({ color_family: ["white"] }));
    expect(boost).toBeCloseTo(0.2, 5);
  });
});

describe("bodyTypeReRanker", () => {
  it("profile.bodyType undefined → 0 (3.1 norm — no CustomerProfileAttribute rows yet)", () => {
    const c = makeCandidate("a", [{ axis: "fit", value: "oversized" }]);
    const boost = bodyTypeReRanker(c, ctx({}, null));
    expect(boost).toBe(0);
  });

  it("profile.bodyType='apple' + candidate fit='oversized' → 0.15", () => {
    const c = makeCandidate("a", [{ axis: "fit", value: "oversized" }]);
    const profile: CustomerProfileSnapshot = { bodyType: "apple" };
    const boost = bodyTypeReRanker(c, ctx({}, profile));
    expect(boost).toBeCloseTo(0.15, 5);
  });
});

describe("rerank() — sum-of-boosts + graceful degradation + registry dispatch", () => {
  it("all four re-rankers match → rerankBoosts = {occasion:0.4, fit:0.3, color:0.2, body_type:0.15}, sum 1.05", () => {
    const candidate = makeCandidate("a", [
      { axis: "occasion", value: "casual" },
      { axis: "fit", value: "oversized" },
      { axis: "color_family", value: "white" },
    ]);
    const qa: QueryAttributes = {
      occasion: ["casual"],
      fit: ["oversized"],
      color_family: ["white"],
    };
    const profile: CustomerProfileSnapshot = { bodyType: "apple" };

    const out = rerank(
      { candidates: [candidate], queryAttributes: qa, profile },
      "FASHION",
    );

    expect(out.candidates).toHaveLength(1);
    const boosts = out.candidates[0].rerankBoosts;
    expect(boosts).toBeDefined();
    expect(boosts!.occasion).toBeCloseTo(0.4, 5);
    expect(boosts!.fit).toBeCloseTo(0.3, 5);
    expect(boosts!.color).toBeCloseTo(0.2, 5);
    expect(boosts!.body_type).toBeCloseTo(0.15, 5);
    const sum = Object.values(boosts!).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.05, 5);
  });

  it("candidate.tags undefined → all four re-rankers return 0 (graceful degradation)", () => {
    // Simulates the orchestrator (mech.6) failing to populate tags
    // before Stage 3 — Stage 3 must not crash, and must produce zero
    // boosts so this candidate ranks last (relative to tagged peers).
    const candidate: CandidateProduct = {
      id: "a",
      handle: "h",
      title: "T",
      productType: null,
      vendor: null,
      featuredImageUrl: null,
      priceMin: null,
      priceMax: null,
      currency: null,
      recommendationPromoted: false,
      recommendationExcluded: false,
      // tags intentionally omitted
    };
    const qa: QueryAttributes = {
      occasion: ["casual"],
      fit: ["oversized"],
      color_family: ["white"],
    };
    const profile: CustomerProfileSnapshot = { bodyType: "apple" };

    expect(occasionReRanker(candidate, ctx(qa, profile))).toBe(0);
    expect(fitReRanker(candidate, ctx(qa, profile))).toBe(0);
    expect(colorReRanker(candidate, ctx(qa, profile))).toBe(0);
    expect(bodyTypeReRanker(candidate, ctx(qa, profile))).toBe(0);
  });

  it("rerank() with mode=ELECTRONICS returns candidates unchanged with fallback meta (registry dispatch)", () => {
    const candidate = makeCandidate("a", [
      { axis: "occasion", value: "casual" },
    ]);
    const out = rerank(
      {
        candidates: [candidate],
        queryAttributes: { occasion: ["casual"] },
        profile: null,
      },
      "ELECTRONICS",
    );

    expect(out.candidates).toEqual([candidate]);
    expect(out.candidates[0].rerankBoosts).toBeUndefined();
    expect(out.contribution.meta?.fallback).toBe("no-mode-reranker");
    expect(out.contribution.meta?.mode).toBe("ELECTRONICS");
    expect(out.contribution.candidatesIn).toBe(1);
    expect(out.contribution.candidatesOut).toBe(1);
  });
});
