// PR-3.1-mech.1: scoring primitive tests.
//
// Five tests covering the metric edges per plan §10:
//   1. precisionAtK with empty expected handles → 0
//   2. relaxedMatchAtK satisfies all axes → 1.0
//   3. relaxedMatchAtK partial match → ratio between 0 and 1
//   4. combinedScore with vs. without expected handles
//   5. classifyStatus thresholds (PASS / PARTIAL / FAIL boundaries)

import { describe, expect, it } from "vitest";
import {
  classifyStatus,
  combinedScore,
  PARTIAL_THRESHOLD,
  PASS_THRESHOLD,
  precisionAtK,
  relaxedMatchAtK,
  type ProductWithTags,
} from "./scoring";

describe("scoring", () => {
  it("precisionAtK returns 0 when expected handles are empty", () => {
    // Empty-handles fixtures (the mech.1 stub state) must not crash or
    // produce a divide-by-zero — they fall back to relaxed-match-only
    // scoring at the combinedScore layer, but precisionAtK itself
    // returns 0.
    expect(precisionAtK(["a", "b", "c"], [])).toBe(0);
    expect(precisionAtK([], [])).toBe(0);
    // Symmetric guard: empty actual returns 0 even if expected is set.
    expect(precisionAtK([], ["a"])).toBe(0);
  });

  it("relaxedMatchAtK returns 1.0 when K satisfying products fill the top-K slots", () => {
    // Under K-based normalization (op debt #54 close, 3.1.8-mech.1):
    // the denominator is K, not actualWithTags.length. To score 1.0, K
    // satisfying products must be returned — having fewer than K returned
    // bounds the score above by returned-count / K.
    const products: ProductWithTags[] = [
      { handle: "shirt-a", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "casual" }] },
      { handle: "shirt-b", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "work" }] },
      { handle: "shirt-c", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "casual" }] },
      { handle: "shirt-d", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "work" }] },
      { handle: "shirt-e", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "casual" }] },
      { handle: "shirt-f", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "work" }] },
    ];
    const filters = { category: ["shirt"], occasion: ["casual", "work"] };
    expect(relaxedMatchAtK(products, filters, 6)).toBe(1);
  });

  it("relaxedMatchAtK returns satisfying / K when some of the returned products fail filters", () => {
    const products: ProductWithTags[] = [
      { handle: "shirt-a", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "casual" }] },
      { handle: "kurta-b", tags: [{ axis: "category", value: "kurta" }, { axis: "occasion", value: "festive" }] },
      { handle: "shirt-c", tags: [{ axis: "category", value: "shirt" }, { axis: "occasion", value: "work" }] },
      { handle: "dress-d", tags: [{ axis: "category", value: "dress" }, { axis: "occasion", value: "event" }] },
    ];
    // Demand category=shirt + occasion in {casual, work}. shirt-a + shirt-c
    // satisfy; kurta-b + dress-d miss. Under K-based: 2 satisfying / k=6 ≈ 0.333.
    // (Pre-3.1.8-mech.1 this returned 2/4 = 0.5 — small-pool incentive removed.)
    const filters = { category: ["shirt"], occasion: ["casual", "work"] };
    expect(relaxedMatchAtK(products, filters, 6)).toBeCloseTo(2 / 6, 5);
  });

  it("relaxedMatchAtK normalizes by K, not actualWithTags.length, when fewer than K candidates returned", () => {
    // Regression test for op debt #54 close (3.1.8-mech.1). Pre-switch,
    // a single satisfying product with k=6 would have scored 1/1 = 1.0
    // (small-pool incentive). Post-switch, the same input scores 1/6 ≈ 0.167.
    // This prevents future code changes from accidentally reverting to
    // the small-pool-favoring denominator.
    const products: ProductWithTags[] = [
      { handle: "shirt-only", tags: [{ axis: "category", value: "shirt" }] },
    ];
    const filters = { category: ["shirt"] };
    expect(relaxedMatchAtK(products, filters, 6)).toBeCloseTo(1 / 6, 5);
  });

  it("combinedScore weights differ when expectedHandles is empty vs. populated", () => {
    const precision = 1.0;
    const relaxed = 0.5;

    // With expected handles: 0.7 × 0.5 + 0.3 × 1.0 = 0.65
    expect(combinedScore(precision, relaxed, true)).toBeCloseTo(0.65, 5);

    // Without expected handles: collapse to relaxed-match-only.
    // The 1.0 precision is ignored — fixtures that haven't been
    // hand-curated for expected handles must not be over-rewarded.
    expect(combinedScore(precision, relaxed, false)).toBeCloseTo(0.5, 5);
  });

  it("classifyStatus respects the PASS / PARTIAL / FAIL thresholds at 0.75 and 0.50", () => {
    // FAIL: below the partial floor.
    expect(classifyStatus(0)).toBe("FAIL");
    expect(classifyStatus(PARTIAL_THRESHOLD - 0.01)).toBe("FAIL");

    // PARTIAL: at or above the partial floor, below the pass floor.
    expect(classifyStatus(PARTIAL_THRESHOLD)).toBe("PARTIAL");
    expect(classifyStatus(0.6)).toBe("PARTIAL");
    expect(classifyStatus(PASS_THRESHOLD - 0.01)).toBe("PARTIAL");

    // PASS: at or above the pass floor.
    expect(classifyStatus(PASS_THRESHOLD)).toBe("PASS");
    expect(classifyStatus(0.9)).toBe("PASS");
    expect(classifyStatus(1.0)).toBe("PASS");
  });
});
