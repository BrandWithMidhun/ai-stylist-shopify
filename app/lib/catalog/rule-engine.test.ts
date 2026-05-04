// PR-2.2-mech.2: regression tests for the applyRules axesStillNeeded
// filter.
//
// Background (the bug this commit fixes): pre-PR-2.2-mech.2, applyRules
// built `axesWithExistingValue` from product.tags WITHOUT filtering by
// status, then used it both for the rule-write filter AND for the
// returned axesStillNeeded. Result: PENDING_REVIEW tags from a prior
// AI run blocked the AI from re-evaluating those axes on subsequent
// runs, contradicting PR-2.1's design intent that PENDING_REVIEW is
// replaceable.
//
// The fix splits into two derived sets:
//   - axesWithExistingValue (status-agnostic): rule-write filter only.
//     "Purely additive" semantic preserved.
//   - axesWithStickyValue (APPROVED + REJECTED only): axesStillNeeded
//     filter only. Lets PENDING_REVIEW axes through to the AI prompt.
//
// These tests pin the new behavior. With rules=[] and dryRun=true,
// applyRules makes no prisma calls — we can test the filter logic
// in isolation.

import { describe, it, expect, vi } from "vitest";

// Minimal prisma mock — applyRules with rules=[] and dryRun=true
// does not hit prisma at runtime, but the module imports it at
// load time, so we still need to vi.mock the surface.
vi.mock("../../db.server", () => ({
  default: {
    taggingRule: { findMany: vi.fn() },
    taxonomyNode: { findUnique: vi.fn() },
    productTag: { findUnique: vi.fn(), create: vi.fn() },
    productTagAudit: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { applyRules } from "./rule-engine.server";
import type { Product, ProductTag } from "@prisma/client";

// Construct a minimal Product with a tag list. applyRules reads only
// a subset of Product fields (title/productType/vendor/shopifyTags/
// priceMin/priceMax/taxonomyNodeId) and ProductTag fields (axis,
// status, locked). The rest can be stubbed.
function makeProduct(
  overrides: Partial<Product> & { tags: Partial<ProductTag>[] },
): Product & { tags: ProductTag[] } {
  return {
    id: "prod-test",
    shopDomain: "test.shop",
    shopifyId: "gid://shopify/Product/1",
    handle: "test-product",
    title: "Test Product",
    descriptionHtml: null,
    descriptionText: null,
    productType: "Shirt",
    vendor: "TestVendor",
    status: "ACTIVE",
    featuredImageUrl: null,
    imageUrls: [],
    priceMin: null,
    priceMax: null,
    currency: null,
    shopifyTags: [],
    totalInventory: null,
    inventoryStatus: "in_stock",
    shopifyCreatedAt: new Date(),
    shopifyUpdatedAt: new Date(),
    syncedAt: new Date(),
    deletedAt: null,
    recommendationExcluded: false,
    taxonomyNodeId: null,
    embedding: null,
    embeddingUpdatedAt: null,
    knowledgeContentHash: null,
    knowledgeContentHashAt: null,
    lastKnowledgeSyncAt: null,
    embeddingContentHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    tags: (overrides.tags ?? []).map((t, i) => ({
      id: `tag-${i}`,
      productId: "prod-test",
      shopDomain: "test.shop",
      axis: "axis",
      value: "value",
      confidence: null,
      source: "AI",
      locked: false,
      metadata: null,
      status: "PENDING_REVIEW" as const,
      reviewedAt: null,
      reviewedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...t,
    })) as ProductTag[],
  } as Product & { tags: ProductTag[] };
}

describe("applyRules axesStillNeeded filter (PR-2.2-mech.2 regression)", () => {
  it("re-tag respects PENDING_REVIEW as NON-sticky — AI can re-evaluate the axis", async () => {
    // Pre-fix: this would have failed (gender excluded from axesStillNeeded).
    // Post-fix: PENDING_REVIEW lets gender through.
    const product = makeProduct({
      tags: [
        { axis: "gender", value: "male", source: "AI", status: "PENDING_REVIEW", locked: false },
      ],
    });
    const result = await applyRules({
      shopDomain: "test.shop",
      product,
      axesNeeded: ["gender", "category"],
      rules: [],
      dryRun: true,
    });
    expect(result.axesStillNeeded).toContain("gender");
    expect(result.axesStillNeeded).toContain("category");
  });

  it("re-tag respects APPROVED as STICKY — axis excluded from axesStillNeeded", async () => {
    const product = makeProduct({
      tags: [
        { axis: "gender", value: "male", source: "AI", status: "APPROVED", locked: false },
      ],
    });
    const result = await applyRules({
      shopDomain: "test.shop",
      product,
      axesNeeded: ["gender", "category"],
      rules: [],
      dryRun: true,
    });
    expect(result.axesStillNeeded).not.toContain("gender");
    expect(result.axesStillNeeded).toContain("category");
  });

  it("re-tag respects REJECTED as STICKY — axis excluded from axesStillNeeded", async () => {
    // NOTE: REJECTED currently blocks the WHOLE axis from AI
    // re-evaluation, not just the rejected (axis, value) pair. The
    // ai-tagger has its own value-level exclusion via
    // rejectedValuesByAxis in the prompt payload, but the axis-level
    // block here makes that value-level guard dead code. Captured
    // as PR-2.2 operational debt; revisit when the merchant review
    // UI lands and we have evidence about whether merchants want
    // axis-level vs. value-level rejection semantics. This test
    // pins the CURRENT behavior so an accidental change is caught.
    const product = makeProduct({
      tags: [
        { axis: "occasion", value: "festive", source: "AI", status: "REJECTED", locked: false },
      ],
    });
    const result = await applyRules({
      shopDomain: "test.shop",
      product,
      axesNeeded: ["occasion", "fit"],
      rules: [],
      dryRun: true,
    });
    expect(result.axesStillNeeded).not.toContain("occasion");
    expect(result.axesStillNeeded).toContain("fit");
  });

  it("dual-guard: PENDING_REVIEW + APPROVED on same axis (different values) — APPROVED wins, axis excluded", async () => {
    // Schema's unique constraint is (productId, axis, value). The
    // same axis can carry multiple rows with different values, e.g.
    // an AI-proposed PENDING_REVIEW alongside a merchant-approved
    // value. The APPROVED row should still drive axis-level
    // stickiness via axesWithStickyValue — the AI shouldn't re-
    // evaluate even though one row on the axis is replaceable.
    const product = makeProduct({
      tags: [
        { axis: "occasion", value: "casual", source: "AI", status: "PENDING_REVIEW", locked: false },
        { axis: "occasion", value: "work", source: "AI", status: "APPROVED", locked: false },
      ],
    });
    const result = await applyRules({
      shopDomain: "test.shop",
      product,
      axesNeeded: ["occasion", "color_family"],
      rules: [],
      dryRun: true,
    });
    expect(result.axesStillNeeded).not.toContain("occasion");
    expect(result.axesStillNeeded).toContain("color_family");
  });

  it("locked axes are excluded regardless of status (no regression from prior locked semantics)", async () => {
    const product = makeProduct({
      tags: [
        { axis: "fit", value: "slim", source: "HUMAN", status: "APPROVED", locked: true },
      ],
    });
    const result = await applyRules({
      shopDomain: "test.shop",
      product,
      axesNeeded: ["fit", "material"],
      rules: [],
      dryRun: true,
    });
    expect(result.axesStillNeeded).not.toContain("fit");
    expect(result.axesStillNeeded).toContain("material");
  });

  it("no tags on product → all requested axes pass through to axesStillNeeded", async () => {
    // Sanity baseline: with no existing tags, applyRules with empty
    // rules should return the full axesNeeded as axesStillNeeded.
    const product = makeProduct({ tags: [] });
    const result = await applyRules({
      shopDomain: "test.shop",
      product,
      axesNeeded: ["gender", "category", "fit", "color_family"],
      rules: [],
      dryRun: true,
    });
    expect(result.axesStillNeeded).toEqual(["gender", "category", "fit", "color_family"]);
  });
});
