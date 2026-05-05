// PR-3.1-mech.5: Stage 4 merchant-signals tests.
//
// Pure-function tests — no mocks needed. Stage 4 mutates each candidate
// to attach merchantSignals = { promoted, velocity }; tests assert
// boost values + the contribution.meta counts.

import { describe, expect, it } from "vitest";
import { stage4MerchantSignals } from "./stage-4-merchant-signals.server";
import type { CandidateProduct } from "./types";

function makeCandidate(
  id: string,
  overrides: Partial<CandidateProduct> = {},
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
    ...overrides,
  };
}

describe("stage4MerchantSignals", () => {
  it("empty input → empty output, contribution counts all zero", () => {
    const out = stage4MerchantSignals([]);
    expect(out.candidates).toEqual([]);
    expect(out.contribution.name).toBe("stage-4-merchant-signals");
    expect(out.contribution.candidatesIn).toBe(0);
    expect(out.contribution.candidatesOut).toBe(0);
    expect(out.contribution.meta?.promotedCount).toBe(0);
    expect(out.contribution.meta?.velocityNullCount).toBe(0);
    expect(out.contribution.meta?.velocityNonZeroCount).toBe(0);
  });

  it("all candidates promoted → merchantSignals.promoted = 0.2 on each; promotedCount === input.length", () => {
    const input = [
      makeCandidate("a", { recommendationPromoted: true }),
      makeCandidate("b", { recommendationPromoted: true }),
      makeCandidate("c", { recommendationPromoted: true }),
    ];
    const out = stage4MerchantSignals(input);
    expect(out.candidates).toHaveLength(3);
    for (const c of out.candidates) {
      expect(c.merchantSignals?.promoted).toBeCloseTo(0.2, 5);
    }
    expect(out.contribution.meta?.promotedCount).toBe(3);
  });

  it("mixed velocity values follow log-scale formula; velocityNullCount counts the zero/undefined state", () => {
    // Velocity values: undefined, 0, 5, 50, 100. Expected boosts:
    //   undefined → 0, 0 → 0, 5 → log10(6)/log10(101) ≈ 0.378 capped 0.3,
    //   50 → log10(51)/log10(101) ≈ 0.851 capped 0.3, 100 → 0.3.
    // Wait — log-scale at low values gives surprisingly high boosts.
    // log10(6) ≈ 0.778; log10(101) ≈ 2.004; ratio ≈ 0.388 → capped 0.3.
    // The log-scale + cap means the boost saturates fast; that's
    // intentional per the planning round (3.2 will recalibrate).
    const input = [
      makeCandidate("a", {}), // undefined velocity
      makeCandidate("b", { salesVelocity30d: 0 }),
      makeCandidate("c", { salesVelocity30d: 5 }),
      makeCandidate("d", { salesVelocity30d: 50 }),
      makeCandidate("e", { salesVelocity30d: 100 }),
    ];
    const out = stage4MerchantSignals(input);

    expect(out.candidates[0].merchantSignals?.velocity).toBe(0);
    expect(out.candidates[1].merchantSignals?.velocity).toBe(0);
    // Mid-range values are saturated at the cap (0.3) by the log-scale
    // shape — verifies the cap's role in the formula.
    expect(out.candidates[2].merchantSignals?.velocity).toBeGreaterThan(0);
    expect(out.candidates[2].merchantSignals?.velocity).toBeLessThanOrEqual(0.3);
    expect(out.candidates[3].merchantSignals?.velocity).toBeCloseTo(0.3, 5);
    expect(out.candidates[4].merchantSignals?.velocity).toBeCloseTo(0.3, 5);

    // velocityNullCount = 2 (undefined + 0); velocityNonZeroCount = 3.
    expect(out.contribution.meta?.velocityNullCount).toBe(2);
    expect(out.contribution.meta?.velocityNonZeroCount).toBe(3);
  });

  it("very high velocity is hard-capped at 0.3", () => {
    const input = [makeCandidate("a", { salesVelocity30d: 10000 })];
    const out = stage4MerchantSignals(input);
    expect(out.candidates[0].merchantSignals?.velocity).toBeCloseTo(0.3, 5);
  });
});
