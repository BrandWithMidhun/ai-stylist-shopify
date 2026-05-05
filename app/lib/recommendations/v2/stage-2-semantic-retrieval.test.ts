// PR-3.1-mech.3: Stage 2 semantic-retrieval tests.
//
// Pattern: vi.hoisted-mocked findSimilarProductsAmongCandidates (the
// sibling helper from similarity-search.server.ts). Stage 2's tests
// mock the helper, NOT the underlying $queryRawUnsafe — Stage 2's
// contract is "given a helper that ranks by cosine distance, build
// the right StageOutput shape", and that contract is what we want to
// pin. Helper-level SQL shape is asserted in
// similarity-search.test.ts.
//
// Four tests, one per Stage 2 invariant:
//   1. Empty input short-circuit — helper not called.
//   2. Subset preservation — only IDs the helper returns appear in
//      the output, all sourced from the input candidate set.
//   3. Distance ordering monotonic ascending — input order is
//      arbitrary; output order matches helper-return order.
//   4. candidatePoolSize honored — third arg passed through verbatim.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { findSimilarProductsAmongCandidates } = vi.hoisted(() => ({
  findSimilarProductsAmongCandidates: vi.fn(),
}));

vi.mock("../../embeddings/similarity-search.server", () => ({
  findSimilarProductsAmongCandidates,
}));

import { stage2SemanticRetrieval } from "./stage-2-semantic-retrieval.server";
import type { CandidateProduct } from "./types";

function makeCandidate(id: string, overrides: Partial<CandidateProduct> = {}): CandidateProduct {
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

beforeEach(() => {
  findSimilarProductsAmongCandidates.mockReset();
  findSimilarProductsAmongCandidates.mockResolvedValue([]);
});

describe("stage2SemanticRetrieval", () => {
  it("returns empty candidates with zero counts and null topDistance when stage1Candidates is empty (helper NOT called)", async () => {
    const out = await stage2SemanticRetrieval([], [0.1, 0.2, 0.3], 50);

    expect(out.candidates).toEqual([]);
    expect(out.contribution.name).toBe("stage-2-semantic-retrieval");
    expect(out.contribution.candidatesIn).toBe(0);
    expect(out.contribution.candidatesOut).toBe(0);
    expect(out.contribution.meta?.topDistance).toBeNull();
    expect(out.contribution.meta?.candidatePoolInputSize).toBe(0);

    // Empty-input short-circuit: helper must not be invoked.
    expect(findSimilarProductsAmongCandidates).not.toHaveBeenCalled();
  });

  it("preserves the helper's subset — output IDs are a subset of stage1Candidates and sourced from the input set", async () => {
    const stage1 = [
      makeCandidate("a"),
      makeCandidate("b"),
      makeCandidate("c"),
      makeCandidate("d"),
      makeCandidate("e"),
    ];
    // Helper returns a 3-item subset.
    findSimilarProductsAmongCandidates.mockResolvedValue([
      { id: "c", distance: 0.12 },
      { id: "a", distance: 0.34 },
      { id: "e", distance: 0.56 },
    ]);

    const out = await stage2SemanticRetrieval(stage1, [0.1, 0.2, 0.3], 50);

    const inputIds = new Set(stage1.map((c) => c.id));
    expect(out.candidates).toHaveLength(3);
    for (const c of out.candidates) {
      expect(inputIds.has(c.id)).toBe(true);
    }
    expect(out.contribution.candidatesIn).toBe(5);
    expect(out.contribution.candidatesOut).toBe(3);
    expect(out.contribution.meta?.candidatePoolInputSize).toBe(5);
  });

  it("output order matches helper-return order (cosine distance ascending) regardless of input order", async () => {
    // Input order is arbitrary (e, c, a, b, d).
    const stage1 = [
      makeCandidate("e"),
      makeCandidate("c"),
      makeCandidate("a"),
      makeCandidate("b"),
      makeCandidate("d"),
    ];
    // Helper ranks them by cosine ASC: c (0.1) → a (0.2) → b (0.3).
    findSimilarProductsAmongCandidates.mockResolvedValue([
      { id: "c", distance: 0.1 },
      { id: "a", distance: 0.2 },
      { id: "b", distance: 0.3 },
    ]);

    const out = await stage2SemanticRetrieval(stage1, [0, 0, 0], 50);

    // Output order tracks the helper, not the input.
    expect(out.candidates.map((c) => c.id)).toEqual(["c", "a", "b"]);
    // similarityDistance attached from the helper's result.
    expect(out.candidates[0].similarityDistance).toBe(0.1);
    expect(out.candidates[1].similarityDistance).toBe(0.2);
    expect(out.candidates[2].similarityDistance).toBe(0.3);
    // topDistance is the smallest = first row's distance.
    expect(out.contribution.meta?.topDistance).toBe(0.1);
  });

  it("passes candidatePoolSize through to the sibling helper as the third arg", async () => {
    const stage1 = [makeCandidate("a"), makeCandidate("b")];
    findSimilarProductsAmongCandidates.mockResolvedValue([
      { id: "a", distance: 0.1 },
      { id: "b", distance: 0.2 },
    ]);
    const queryVector = [0.7, 0.8, 0.9];
    const poolSize = 87;

    await stage2SemanticRetrieval(stage1, queryVector, poolSize);

    expect(findSimilarProductsAmongCandidates).toHaveBeenCalledTimes(1);
    const args = findSimilarProductsAmongCandidates.mock.calls[0];
    expect(args[0]).toBe(queryVector);
    expect(args[1]).toEqual(["a", "b"]);
    expect(args[2]).toBe(poolSize);
  });
});
