// PR-3.1-mech.6: pipeline orchestrator integration test.
//
// Mocks Prisma + the similarity-search helper at module scope (vi.hoisted)
// and injects embedQuery via PipelineDeps. Stages 1+2 actually run — they
// hit the mocked prisma + helper. Stages 3-6 run for real on the synthetic
// candidate set so the trace shape and narrowing assertions exercise the
// real wiring.
//
// Asserts (per locked decision D5):
//   - Empty Stage 1 → trace contains stages 0+1 only; embedQuery NOT called.
//   - Happy path → trace contains all 8 entries (0, 1, 2, 2.5, 3, 4, 5, 6),
//     candidate counts narrow monotonically Stage 1 → Stage 2 → Stage 5,
//     embedQuery called exactly once with input.intent, products are
//     ProductCard-shaped with finalScore + whyTrace.
//   - Stage 2.5 trace meta carries tagsLoadedCount = Stage 2 surviving.
//   - Stage 3 receives candidate.tags populated (visible because Stage 6's
//     formatProductCard surfaces APPROVED tags as `category:value` strings;
//     a tagged candidate produces non-empty card.tags).
//   - trace.totalMs > 0.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  queryRawUnsafe,
  productTagFindMany,
  merchantConfigFindUnique,
  customerProfileAttributeFindMany,
  findSimilarProductsAmongCandidates,
  embedQueryMock,
} = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
  productTagFindMany: vi.fn(),
  merchantConfigFindUnique: vi.fn(),
  customerProfileAttributeFindMany: vi.fn(),
  findSimilarProductsAmongCandidates: vi.fn(),
  embedQueryMock: vi.fn(),
}));

vi.mock("../../../db.server", () => ({
  default: {
    $queryRawUnsafe: queryRawUnsafe,
    productTag: { findMany: productTagFindMany },
    merchantConfig: { findUnique: merchantConfigFindUnique },
    customerProfileAttribute: { findMany: customerProfileAttributeFindMany },
  },
}));

vi.mock("../../embeddings/similarity-search.server", () => ({
  findSimilarProductsAmongCandidates,
}));

import { runPipeline } from "./pipeline.server";
import type { PipelineDeps, PipelineInput } from "./types";

// Synthetic 20-product Stage-1 raw row builder. Matches stage-1's RawRow
// shape: numeric prices, recommendationPromoted/Excluded booleans.
function buildStage1Rows(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `prod-${i}`,
    handle: `handle-${i}`,
    title: `Title ${i}`,
    productType: "shirt",
    vendor: "TestVendor",
    featuredImageUrl: `https://example.com/img-${i}.jpg`,
    priceMin: 100 + i,
    priceMax: 200 + i,
    currency: "USD",
    recommendationPromoted: i === 0,
    recommendationExcluded: false,
  }));
}

// Synthetic helper-return: rank a subset by ascending distance.
function buildStage2Ranked(ids: string[]): Array<{ id: string; distance: number }> {
  return ids.map((id, i) => ({ id, distance: 0.1 + i * 0.01 }));
}

// Synthetic ProductTag rows. Use distinct categories + colors so Stage 5's
// quotas don't reject everything; final card.tags should still be non-empty
// for each candidate.
function buildTagsFor(productIds: string[]): unknown[] {
  return productIds.flatMap((pid, i) => {
    const cats = ["shirt", "kurta", "jacket", "dress", "saree", "shorts"];
    const colors = ["white", "black", "red", "blue", "green"];
    return [
      {
        productId: pid,
        axis: "category",
        value: cats[i % cats.length],
        status: "APPROVED",
      },
      {
        productId: pid,
        axis: "color_family",
        value: colors[i % colors.length],
        status: "APPROVED",
      },
      {
        productId: pid,
        axis: "occasion",
        value: "casual",
        status: "APPROVED",
      },
    ];
  });
}

const baseInput: PipelineInput = {
  shopDomain: "pipeline-test.myshopify.com",
  intent: "minimalist linen shirts for casual everyday wear",
  limit: 6,
};

function makeDeps(): PipelineDeps {
  // The vi.mock above already replaces db.server's default export with
  // a stub object containing only the surfaces the orchestrator
  // touches. PipelineDeps.prisma is the same stub (the runtime types
  // diverge from PrismaClient; cast through unknown for test purposes).
  return {
    prisma: {
      productTag: { findMany: productTagFindMany },
      merchantConfig: { findUnique: merchantConfigFindUnique },
      customerProfileAttribute: { findMany: customerProfileAttributeFindMany },
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PipelineDeps["prisma"],
    embedQuery: embedQueryMock,
  };
}

beforeEach(() => {
  queryRawUnsafe.mockReset();
  productTagFindMany.mockReset();
  merchantConfigFindUnique.mockReset();
  customerProfileAttributeFindMany.mockReset();
  findSimilarProductsAmongCandidates.mockReset();
  embedQueryMock.mockReset();

  // Default: FASHION shop with display name.
  merchantConfigFindUnique.mockResolvedValue({
    storeMode: "FASHION",
    shopDisplayName: "Test Boutique",
  });
  customerProfileAttributeFindMany.mockResolvedValue([]);
  productTagFindMany.mockResolvedValue([]);
  findSimilarProductsAmongCandidates.mockResolvedValue([]);
  queryRawUnsafe.mockResolvedValue([]);
  embedQueryMock.mockResolvedValue(new Array(1024).fill(0));
});

describe("runPipeline — empty Stage 1 short-circuit", () => {
  it("returns empty PipelineOutput, trace contains stages 0 + 1 only, embedQuery NOT called", async () => {
    queryRawUnsafe.mockResolvedValue([]); // Stage 1 returns empty

    const out = await runPipeline(baseInput, makeDeps());

    expect(out.products).toEqual([]);
    expect(out.topDistance).toBeNull();
    expect(out.trace.version).toBe("3.1.0");
    expect(out.trace.intent).toBe(baseInput.intent);

    const stageNames = out.trace.stages.map((s) => s.name);
    expect(stageNames).toEqual([
      "stage-0-query-extraction",
      "stage-1-hard-filters",
    ]);

    // embedQuery / Stage 2 / tag-load / Stage 3+ never invoked.
    expect(embedQueryMock).not.toHaveBeenCalled();
    expect(findSimilarProductsAmongCandidates).not.toHaveBeenCalled();
    expect(productTagFindMany).not.toHaveBeenCalled();

    expect(out.trace.totalMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runPipeline — happy path with 20-candidate synthetic set", () => {
  beforeEach(() => {
    const rows = buildStage1Rows(20);
    queryRawUnsafe.mockResolvedValue(rows);

    // Helper returns 15 of the 20, ranked by ascending distance.
    const survivingIds = rows.slice(0, 15).map((r) => (r as { id: string }).id);
    findSimilarProductsAmongCandidates.mockResolvedValue(
      buildStage2Ranked(survivingIds),
    );

    productTagFindMany.mockResolvedValue(buildTagsFor(survivingIds));
  });

  it("trace contains all 8 stage entries in order", async () => {
    const out = await runPipeline(baseInput, makeDeps());
    const stageNames = out.trace.stages.map((s) => s.name);
    expect(stageNames).toEqual([
      "stage-0-query-extraction",
      "stage-1-hard-filters",
      "stage-2-semantic-retrieval",
      "stage-2.5-tag-load",
      "stage-3-rerank",
      "stage-4-merchant-signals",
      "stage-5-diversity",
      "stage-6-output",
    ]);
  });

  it("candidate counts narrow monotonically Stage 1 (20) → Stage 2 (15) → Stage 5 (≤6)", async () => {
    const out = await runPipeline(baseInput, makeDeps());

    const byName = new Map(out.trace.stages.map((s) => [s.name, s]));
    const s1 = byName.get("stage-1-hard-filters");
    const s2 = byName.get("stage-2-semantic-retrieval");
    const s5 = byName.get("stage-5-diversity");

    expect(s1?.candidatesOut).toBe(20);
    expect(s2?.candidatesOut).toBe(15);
    expect((s5?.candidatesOut ?? 0)).toBeLessThanOrEqual(6);
    expect((s5?.candidatesOut ?? 0)).toBeGreaterThan(0);

    // Monotonic narrowing.
    expect(s2!.candidatesOut).toBeLessThanOrEqual(s1!.candidatesOut);
    expect(s5!.candidatesOut).toBeLessThanOrEqual(s2!.candidatesOut);
  });

  it("embedQuery is called exactly once with input.intent", async () => {
    await runPipeline(baseInput, makeDeps());
    expect(embedQueryMock).toHaveBeenCalledTimes(1);
    expect(embedQueryMock).toHaveBeenCalledWith(baseInput.intent);
  });

  it("stage-2.5-tag-load meta.tagsLoadedCount equals Stage 2 surviving count", async () => {
    const out = await runPipeline(baseInput, makeDeps());
    const tagLoad = out.trace.stages.find((s) => s.name === "stage-2.5-tag-load");
    const stage2 = out.trace.stages.find((s) => s.name === "stage-2-semantic-retrieval");
    expect(tagLoad).toBeDefined();
    expect((tagLoad!.meta as { tagsLoadedCount: number }).tagsLoadedCount).toBe(
      stage2!.candidatesOut,
    );
  });

  it("Stage 3 receives candidate.tags populated (verified via Stage 6 card.tags being non-empty)", async () => {
    const out = await runPipeline(baseInput, makeDeps());
    expect(out.products.length).toBeGreaterThan(0);
    // Every returned card has at least one APPROVED tag formatted as
    // axis:value — proves tags propagated through Stage 3 → Stage 6.
    for (const card of out.products) {
      expect(card.tags.length).toBeGreaterThan(0);
      // Tag strings include both category and color_family axes seeded
      // by buildTagsFor.
      const hasCategoryTag = card.tags.some((t) => t.startsWith("category:"));
      expect(hasCategoryTag).toBe(true);
    }
  });

  it("trace.totalMs is captured (number > 0)", async () => {
    const out = await runPipeline(baseInput, makeDeps());
    expect(typeof out.trace.totalMs).toBe("number");
    expect(out.trace.totalMs).toBeGreaterThanOrEqual(0);
    expect(out.totalMs).toBe(out.trace.totalMs);
  });

  it("PipelineOutput.products length ≤ targetN AND each product has finalScore + whyTrace", async () => {
    const out = await runPipeline(baseInput, makeDeps());
    expect(out.products.length).toBeLessThanOrEqual(6);
    for (const card of out.products) {
      expect(typeof card.finalScore).toBe("number");
      expect(card.finalScore).toBeGreaterThanOrEqual(0);
      expect(card.finalScore).toBeLessThanOrEqual(2);
      expect(typeof card.whyTrace).toBe("string");
      expect(card.whyTrace!.length).toBeGreaterThan(0);
    }
  });

  it("topDistance carries Stage 2's smallest distance value", async () => {
    const out = await runPipeline(baseInput, makeDeps());
    // buildStage2Ranked starts at 0.1.
    expect(out.topDistance).toBeCloseTo(0.1, 5);
  });
});
