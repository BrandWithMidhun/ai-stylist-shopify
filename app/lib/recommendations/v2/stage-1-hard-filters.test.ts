// PR-3.1-mech.2: Stage 1 hard-filter tests.
//
// Test pattern: vi.mock the prisma surface and assert on the SQL string
// and positional params passed to $queryRawUnsafe. This matches the
// universal repo pattern (rule-engine.test.ts, tagging-cost.test.ts,
// order-events.test.ts) — see vitest.config.ts:7 ("Minimal Vitest
// config for unit-testing pure server-side modules").
//
// CLAUDE.md operational notes lock the rationale: "Production Railway
// Postgres is the only database. There is no separate local or shadow
// DB." End-to-end behavioral coverage of Stage 1 lands in mech.6's
// full-pipeline integration test on Railway.
//
// Six tests, one per Stage 1 invariant from the plan §6:
//   1. Empty result handling (DB resolves []).
//   2. Base WHERE clauses always present.
//   3. queryAttributes.gender = ['male'] → APPROVED-tag EXISTS predicate
//      added with axis name + values array in params.
//   4. Empty queryAttributes per-axis: no gender predicate, no category
//      predicate (sub-assertion per axis per the locked refinement).
//   5. priceMin/priceMax overlapping range — both clauses present.
//   6. EXISTS on ProductVariant.availableForSale always present.

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted by vitest's module transform; the factory closes
// over module-scope identifiers that are not yet initialized at the
// hoisted call site. vi.hoisted is the official escape hatch — it
// hoists the wrapped initialization alongside vi.mock so both run
// before any test-file imports execute.
const { queryRawUnsafe } = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
}));

vi.mock("../../../db.server", () => ({
  default: {
    $queryRawUnsafe: queryRawUnsafe,
  },
}));

import { stage1HardFilters } from "./stage-1-hard-filters.server";
import type { PipelineInput, QueryAttributes } from "./types";

const baseInput: PipelineInput = {
  shopDomain: "test-stage-1.myshopify.com",
  intent: "test intent",
};

beforeEach(() => {
  queryRawUnsafe.mockReset();
  queryRawUnsafe.mockResolvedValue([]);
});

describe("stage1HardFilters", () => {
  it("returns empty candidates with zero counts when prisma resolves []", async () => {
    queryRawUnsafe.mockResolvedValue([]);

    const out = await stage1HardFilters(baseInput, {}, "FASHION");

    // Primary assertion (per the locked refinement to invariant 1):
    // output shape is {candidates: [], contribution: {candidatesIn: 0,
    // candidatesOut: 0, ...}}.
    expect(out.candidates).toEqual([]);
    expect(out.contribution.candidatesIn).toBe(0);
    expect(out.contribution.candidatesOut).toBe(0);
    expect(out.contribution.name).toBe("stage-1-hard-filters");
    expect(out.contribution.ms).toBeGreaterThanOrEqual(0);

    // Secondary: shopDomain is the first positional param. The mock
    // call signature is (sql, ...params) so params[0] = call[1].
    const call = queryRawUnsafe.mock.calls[0];
    expect(call[1]).toBe("test-stage-1.myshopify.com");
  });

  it("base WHERE clauses are always present (status, deletedAt, recommendationExcluded, embedding)", async () => {
    await stage1HardFilters(baseInput, {}, "FASHION");

    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain(`p."shopDomain" = $1`);
    expect(sql).toContain(`p.status = 'ACTIVE'`);
    expect(sql).toContain(`p."deletedAt" IS NULL`);
    expect(sql).toContain(`p."recommendationExcluded" = false`);
    expect(sql).toContain(`p."embedding" IS NOT NULL`);
    expect(sql).toContain("LIMIT 1000");
  });

  it("when queryAttributes.gender = ['male'], adds the APPROVED ProductTag EXISTS predicate with 'gender' + ['male'] in params", async () => {
    const qa: QueryAttributes = { gender: ["male"] };

    await stage1HardFilters(baseInput, qa, "FASHION");

    const call = queryRawUnsafe.mock.calls[0];
    const sql = call[0] as string;
    const params = call.slice(1);

    // SQL contains the per-axis EXISTS block — APPROVED-only,
    // axis-name parameterized, values array via ANY.
    expect(sql).toContain(`FROM "ProductTag" t`);
    expect(sql).toContain(`t.status = 'APPROVED'`);
    expect(sql).toMatch(/t\.axis = \$\d+/);
    expect(sql).toMatch(/t\.value = ANY\(\$\d+::text\[\]\)/);

    // Params carry the axis name and the values array.
    expect(params).toContain("gender");
    const arrayParam = params.find(
      (p) => Array.isArray(p) && (p as string[]).includes("male"),
    );
    expect(arrayParam).toBeDefined();
  });

  it("when queryAttributes is empty, no gender or category EXISTS predicate is added (per-axis sub-assertions)", async () => {
    // Locked refinement to invariant 4: per-axis sub-assertions for
    // both `gender` and `category`. Empty queryAttributes covers the
    // undefined case for both axes.
    await stage1HardFilters(baseInput, {}, "FASHION");

    const call = queryRawUnsafe.mock.calls[0];
    const sql = call[0] as string;
    const params = call.slice(1);

    // No ProductTag EXISTS block at all when no hard-filter axes
    // contribute — covers BOTH gender and category in one assertion
    // because either contributing would have inserted the block.
    expect(sql).not.toContain(`FROM "ProductTag" t`);
    expect(sql).not.toMatch(/t\.axis = \$\d+/);

    // Per-axis sub-assertions on params: neither axis name lands in
    // the params array.
    expect(params).not.toContain("gender");
    expect(params).not.toContain("category");

    // Symmetric guard: the explicit empty-array case also produces
    // no predicate (gender: [] is treated identically to undefined).
    queryRawUnsafe.mockClear();
    await stage1HardFilters(baseInput, { gender: [], category: [] }, "FASHION");
    const call2 = queryRawUnsafe.mock.calls[0];
    const sql2 = call2[0] as string;
    const params2 = call2.slice(1);
    expect(sql2).not.toContain(`FROM "ProductTag" t`);
    expect(params2).not.toContain("gender");
    expect(params2).not.toContain("category");
  });

  it("priceMin and priceMax add overlapping-range clauses with numeric params", async () => {
    const input: PipelineInput = {
      ...baseInput,
      priceMin: 150,
      priceMax: 300,
    };

    await stage1HardFilters(input, {}, "FASHION");

    const call = queryRawUnsafe.mock.calls[0];
    const sql = call[0] as string;
    const params = call.slice(1);

    // Overlapping-range: priceMax >= priceMin AND priceMin <= priceMax.
    // Matches the existing search-products / similarity-search posture.
    expect(sql).toMatch(/p\."priceMax" >= \$\d+/);
    expect(sql).toMatch(/p\."priceMin" <= \$\d+/);

    expect(params).toContain(150);
    expect(params).toContain(300);
  });

  it("EXISTS check on ProductVariant.availableForSale is always present in the SQL", async () => {
    // Asserted across two calls — empty queryAttributes and a populated
    // one — to confirm the variant filter is structural, not a function
    // of the query shape.
    await stage1HardFilters(baseInput, {}, "FASHION");
    const sql1 = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql1).toContain(`FROM "ProductVariant" v`);
    expect(sql1).toContain(`v."availableForSale" = true`);

    queryRawUnsafe.mockClear();
    await stage1HardFilters(
      baseInput,
      { gender: ["female"], category: ["dress"] },
      "FASHION",
    );
    const sql2 = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql2).toContain(`FROM "ProductVariant" v`);
    expect(sql2).toContain(`v."availableForSale" = true`);
  });
});
