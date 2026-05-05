// PR-3.1-mech.5: Stage 5 diversity tests.
//
// Pure-function tests — no mocks needed. Six tests covering MMR + soft
// quotas + fallback + flaggedOos stub.

import { describe, expect, it } from "vitest";
import { stage5Diversity } from "./stage-5-diversity.server";
import type { CandidateProduct } from "./types";

function makeCandidate(
  id: string,
  tags: Array<{ axis: string; value: string }>,
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
    tags: tags.map((t) => ({ ...t, status: "APPROVED" })),
  };
}

describe("stage5Diversity", () => {
  it("empty input → empty output, no fallback fired", () => {
    const out = stage5Diversity([], 6);
    expect(out.candidates).toEqual([]);
    expect(out.contribution.candidatesOut).toBe(0);
    expect(out.contribution.meta?.diversityQuotaFallback).toBe(false);
    expect(out.contribution.meta?.fallbackFilledCount).toBe(0);
  });

  it("targetN=3 with 5 distinct candidates (all different categories + colors) → first 3 selected, no quotas/MMR triggered, no fallback", () => {
    const input = [
      makeCandidate("a", [{ axis: "category", value: "shirt" }, { axis: "color_family", value: "white" }]),
      makeCandidate("b", [{ axis: "category", value: "kurta" }, { axis: "color_family", value: "blue" }]),
      makeCandidate("c", [{ axis: "category", value: "jacket" }, { axis: "color_family", value: "red" }]),
      makeCandidate("d", [{ axis: "category", value: "dress" }, { axis: "color_family", value: "green" }]),
      makeCandidate("e", [{ axis: "category", value: "saree" }, { axis: "color_family", value: "yellow" }]),
    ];
    const out = stage5Diversity(input, 3);
    expect(out.candidates.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(out.contribution.meta?.diversityQuotaFallback).toBe(false);
    expect(out.contribution.meta?.skippedCount).toBe(0);
    expect(out.contribution.meta?.fallbackFilledCount).toBe(0);
    // Every selected has diversityPenalty (the MMR penalty against
    // already-selected; first candidate's is 0 by definition).
    expect(out.candidates[0].diversityPenalty).toBe(0);
  });

  it("category quota: 5 inputs all category=shirt with distinct colors → first 2 accepted, then 3 skipped by quota; fallback fills targetN=3 → diversityQuotaFallback=true, fallbackFilledCount=1", () => {
    const input = [
      makeCandidate("a", [{ axis: "category", value: "shirt" }, { axis: "color_family", value: "white" }]),
      makeCandidate("b", [{ axis: "category", value: "shirt" }, { axis: "color_family", value: "blue" }]),
      makeCandidate("c", [{ axis: "category", value: "shirt" }, { axis: "color_family", value: "red" }]),
      makeCandidate("d", [{ axis: "category", value: "shirt" }, { axis: "color_family", value: "green" }]),
      makeCandidate("e", [{ axis: "category", value: "shirt" }, { axis: "color_family", value: "yellow" }]),
    ];
    const out = stage5Diversity(input, 3);
    expect(out.candidates).toHaveLength(3);
    // First 2 accepted (a, b — categoryCount becomes 2). c/d/e all
    // hit the category quota in first pass; fallback fills the 3rd
    // slot from skipped (preserving relevance order — c is first skipped).
    expect(out.candidates.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(out.contribution.meta?.diversityQuotaFallback).toBe(true);
    expect(out.contribution.meta?.skippedCount).toBe(3);
    expect(out.contribution.meta?.fallbackFilledCount).toBe(1);
    // Fallback-filled candidate's diversityPenalty retains the
    // would-have-rejection value (the MMR penalty against selected
    // a + b; since c shares the same category=shirt tag-set
    // structure, jaccard is non-zero — but the QUOTA was the rejector,
    // not MMR. The trace records the MMR penalty for honesty;
    // the algorithm doesn't store quota-vs-MMR breakdown).
    expect(out.candidates[2].diversityPenalty).toBeGreaterThan(0);
  });

  it("MMR threshold: 5 candidates with very high tag overlap; targetN=3 → some accepted by quotas, MMR rejects high-overlap ones, fallback fills remainder", () => {
    // Each candidate shares many tags with every other. Quota constraint
    // (categoryMax=2 per shirt) plus MMR threshold (0.6) interact: a
    // and b accepted (they're identical category but quotas allow 2);
    // c hits the quota (third shirt) in first pass; fallback fills.
    // Use distinct categories so the quota doesn't dominate — that
    // way MMR is the gate.
    const sharedTags = [
      { axis: "occasion", value: "casual" },
      { axis: "style_type", value: "minimal" },
      { axis: "fit", value: "regular" },
      { axis: "material", value: "cotton" },
    ];
    const input = [
      makeCandidate("a", [{ axis: "category", value: "shirt" }, ...sharedTags]),
      makeCandidate("b", [{ axis: "category", value: "kurta" }, ...sharedTags]),
      makeCandidate("c", [{ axis: "category", value: "jacket" }, ...sharedTags]),
      makeCandidate("d", [{ axis: "category", value: "dress" }, ...sharedTags]),
      makeCandidate("e", [{ axis: "category", value: "saree" }, ...sharedTags]),
    ];
    // jaccard between any two: (shared 4 + matching category 0) /
    // (4 + 1 + 4 + 1 - 4) = 4/6 ≈ 0.67. That's > 0.6 threshold.
    // a accepted (no peers); b's penalty against a = 0.67 → MMR-rejected.
    // c, d, e all penalized similarly. So selected = [a]; skipped = 4;
    // fallback fills 2 from skipped.
    const out = stage5Diversity(input, 3);
    expect(out.candidates).toHaveLength(3);
    expect(out.candidates[0].id).toBe("a");
    expect(out.contribution.meta?.diversityQuotaFallback).toBe(true);
    expect(out.contribution.meta?.fallbackFilledCount).toBeGreaterThan(0);
    // Fallback-filled candidates' diversityPenalty captures the MMR
    // penalty that triggered the original rejection — > 0.6 in this
    // setup.
    for (let i = 1; i < out.candidates.length; i++) {
      expect(out.candidates[i].diversityPenalty).toBeGreaterThan(0.6);
    }
  });

  it("flaggedOos stays undefined on every output candidate (D6 stub)", () => {
    const input = [
      makeCandidate("a", [{ axis: "category", value: "shirt" }]),
      makeCandidate("b", [{ axis: "category", value: "kurta" }]),
    ];
    const out = stage5Diversity(input, 6);
    for (const c of out.candidates) {
      expect(c.flaggedOos).toBeUndefined();
    }
  });

  it("diversityQuotaFallback recorded false when no fallback fires", () => {
    const input = [
      makeCandidate("a", [{ axis: "category", value: "shirt" }, { axis: "color_family", value: "white" }]),
      makeCandidate("b", [{ axis: "category", value: "kurta" }, { axis: "color_family", value: "blue" }]),
    ];
    const out = stage5Diversity(input, 6);
    // Two distinct candidates; both pass first-pass; selected.length=2 < cap=6,
    // but skipped is empty, so fallback can't fill. diversityQuotaFallback
    // is false because fallbackFilledCount is 0.
    expect(out.candidates).toHaveLength(2);
    expect(out.contribution.meta?.diversityQuotaFallback).toBe(false);
    expect(out.contribution.meta?.fallbackFilledCount).toBe(0);
  });
});
