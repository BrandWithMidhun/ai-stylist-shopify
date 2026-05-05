// PR-3.1-mech.5: Stage 6 output tests.
//
// Pure-function tests — no mocks needed. Tests cover finalScore
// formula, whyTrace template fragment-stitching (high-signal +
// no-signal fallback paths), and ProductCard format.

import { describe, expect, it } from "vitest";
import { formatProductCard, stage6Output } from "./stage-6-output.server";
import type { CandidateProduct } from "./types";

const SHOP_META = { shopName: "TestShop" };

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

describe("stage6Output finalScore", () => {
  it("computes finalScore = similarityScore + rerankBoostSum + merchantBoost - diversityPenalty (concrete numeric example)", () => {
    // similarityDistance=0.2 → similarityScore = 1 - 0.2 = 0.8
    // rerankBoosts.occasion=0.4, fit=0.3 → sum 0.7
    // merchantSignals.promoted=0.2, velocity=0.1 → sum 0.3
    // diversityPenalty=0.1
    // raw = 0.8 + 0.7 + 0.3 - 0.1 = 1.7 (within [0, 2.0])
    const c = makeCandidate("a", {
      similarityDistance: 0.2,
      rerankBoosts: { occasion: 0.4, fit: 0.3 },
      merchantSignals: { promoted: 0.2, velocity: 0.1 },
      diversityPenalty: 0.1,
    });
    const out = stage6Output([c], SHOP_META);
    expect(out.candidates[0].finalScore).toBeCloseTo(1.7, 5);
  });

  it("clamps finalScore to [0, 2.0]", () => {
    // similarityDistance=0 → similarityScore=1; rerankBoostSum=2.0;
    // merchantBoost=0.5; diversityPenalty=0 → raw=3.5 → clamped to 2.0.
    const high = makeCandidate("a", {
      similarityDistance: 0,
      rerankBoosts: { occasion: 0.4, fit: 0.3, color: 0.2, body_type: 0.15, extra: 0.95 },
      merchantSignals: { promoted: 0.2, velocity: 0.3 },
    });
    const out = stage6Output([high], SHOP_META);
    expect(out.candidates[0].finalScore).toBe(2.0);

    // diversityPenalty=10 → raw very negative → clamped to 0.
    const low = makeCandidate("b", {
      similarityDistance: 1,
      diversityPenalty: 10,
    });
    const out2 = stage6Output([low], SHOP_META);
    expect(out2.candidates[0].finalScore).toBe(0);
  });
});

describe("stage6Output whyTrace template", () => {
  it("produces a 1-2 sentence trace when multiple signals are above their thresholds", () => {
    const c = makeCandidate("a", {
      similarityDistance: 0.1, // < 0.3 threshold
      rerankBoosts: { occasion: 0.4, fit: 0.3, color: 0.2 },
      merchantSignals: { promoted: 0.2, velocity: 0 },
    });
    const out = stage6Output([c], SHOP_META);
    const why = out.candidates[0].whyTrace ?? "";
    // Capped at FRAGMENT_MAX=2 fragments — first fragment leads.
    expect(why).toMatch(/^Strong occasion match/);
    // Second fragment lowercase-leading per template ("fit matches...").
    expect(why.split(". ").length).toBe(2);
    expect(why.endsWith(".")).toBe(true);
  });

  it("falls back to 'relevant to your search' when no signal exceeds its threshold", () => {
    const c = makeCandidate("a", {
      similarityDistance: 0.9, // > 0.3 threshold (low similarity)
      rerankBoosts: { occasion: 0.1, fit: 0.05, color: 0.1 },
      merchantSignals: { promoted: 0, velocity: 0 },
    });
    const out = stage6Output([c], SHOP_META);
    expect(out.candidates[0].whyTrace).toBe("Relevant to your search.");
  });

  it("includes the shop name in the promoted fragment", () => {
    const c = makeCandidate("a", {
      similarityDistance: 0.5,
      rerankBoosts: {},
      merchantSignals: { promoted: 0.2, velocity: 0 },
    });
    const out = stage6Output([c], { shopName: "AcmeShop" });
    expect(out.candidates[0].whyTrace).toContain("AcmeShop");
  });
});

describe("formatProductCard", () => {
  it("mirrors legacy ProductCard shape with v2 telemetry fields populated", () => {
    const c = makeCandidate("a", {
      featuredImageUrl: "https://example.com/img.jpg",
      currency: "USD",
      similarityDistance: 0.2,
      rerankBoosts: { occasion: 0.4 },
      merchantSignals: { promoted: 0, velocity: 0 },
      diversityPenalty: 0,
      tags: [
        { axis: "category", value: "shirt", status: "APPROVED" },
        { axis: "color_family", value: "white", status: "APPROVED" },
        { axis: "occasion", value: "draft-only", status: "PENDING_REVIEW" }, // filtered out
      ],
    });
    const card = formatProductCard(c, SHOP_META);

    // Legacy shape parity.
    expect(card.id).toBe("a");
    expect(card.handle).toBe("handle-a");
    expect(card.title).toBe("Title a");
    expect(card.imageUrl).toBe("https://example.com/img.jpg");
    expect(card.price).toBe(100);
    expect(card.currency).toBe("USD");
    expect(card.productUrl).toBe("/products/handle-a");
    // PENDING_REVIEW tag is filtered; only APPROVED tags surface.
    expect(card.tags).toEqual(["category:shirt", "color_family:white"]);

    // v2 telemetry.
    expect(card.finalScore).toBeGreaterThan(0);
    expect(card.whyTrace).toBeTruthy();
    expect(card.traceContributions).toBeDefined();
    expect(card.traceContributions!.length).toBeGreaterThan(0);
    const stages = card.traceContributions!.map((t) => t.stage);
    expect(stages).toContain("stage-2-semantic-retrieval");
    expect(stages).toContain("stage-3-rerank");
    expect(stages).toContain("stage-4-merchant-signals");
    expect(stages).toContain("stage-5-diversity");
  });
});
