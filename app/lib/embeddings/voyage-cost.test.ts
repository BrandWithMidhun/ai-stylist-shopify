// PR-3.1-mech.6: voyage-cost helper tests.
//
// Pure-function tests — no mocks needed. Validates the $0.06/Mtok rate
// rounding behavior at the boundary cases the RE_EMBED worker handler
// will hit (zero-token short-reads, the 1M-token round number, and
// sub-cent values that exercise the rounding path).

import { describe, expect, it } from "vitest";
import { computeVoyageCost, VOYAGE_3_USD_PER_MTOK } from "./voyage-cost.server";

describe("computeVoyageCost", () => {
  it("returns 0 micros for 0 tokens", () => {
    const out = computeVoyageCost(0);
    expect(out.tokens).toBe(0);
    expect(out.costMicros).toBe(0);
  });

  it("returns 60000 micros for 1,000,000 tokens ($0.06)", () => {
    const out = computeVoyageCost(1_000_000);
    expect(out.tokens).toBe(1_000_000);
    expect(out.costMicros).toBe(60_000);
  });

  it("rounds 500 tokens to 30 micros", () => {
    // 500 * 0.06 = 30 exactly — no rounding ambiguity.
    const out = computeVoyageCost(500);
    expect(out.costMicros).toBe(30);
  });

  it("clamps negative or fractional inputs to non-negative integer tokens", () => {
    expect(computeVoyageCost(-100).tokens).toBe(0);
    expect(computeVoyageCost(-100).costMicros).toBe(0);
    expect(computeVoyageCost(123.7).tokens).toBe(123);
  });

  it("exposes the published rate constant", () => {
    expect(VOYAGE_3_USD_PER_MTOK).toBe(0.06);
  });
});
