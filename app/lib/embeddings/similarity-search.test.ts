// PR-3.1-mech.3: tests for findSimilarProductsAmongCandidates.
//
// Scope: only the new sibling helper added in this commit. The
// pre-existing findSimilarProducts function is not retroactively
// covered here — that's out of mech.3 scope (CLAUDE.md: do only what
// is requested; do not expand scope).
//
// Test pattern: vi.hoisted-mocked $queryRawUnsafe + assertions on
// the SQL string + positional params. Established by mech.2's
// stage-1-hard-filters.test.ts; reused without modification.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryRawUnsafe } = vi.hoisted(() => ({
  queryRawUnsafe: vi.fn(),
}));

vi.mock("../../db.server", () => ({
  default: {
    $queryRawUnsafe: queryRawUnsafe,
    // findSimilarProducts (the existing helper) calls $queryRaw +
    // prisma.product.findMany; we don't exercise it in this file,
    // but the module imports prisma at load time so the stub must
    // be shaped to satisfy any incidental access.
    $queryRaw: vi.fn(),
    product: { findMany: vi.fn() },
  },
}));

import { findSimilarProductsAmongCandidates } from "./similarity-search.server";

beforeEach(() => {
  queryRawUnsafe.mockReset();
  queryRawUnsafe.mockResolvedValue([]);
});

describe("findSimilarProductsAmongCandidates", () => {
  it("returns [] without invoking $queryRawUnsafe when candidateIds is empty", async () => {
    const out = await findSimilarProductsAmongCandidates([0.1, 0.2, 0.3], [], 50);
    expect(out).toEqual([]);
    // Empty-input short-circuit: zero DB roundtrips.
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("calls $queryRawUnsafe with the documented SQL shape and positional params for non-empty candidateIds", async () => {
    queryRawUnsafe.mockResolvedValue([
      { id: "c", distance: 0.12 },
      { id: "a", distance: 0.34 },
      { id: "b", distance: 0.56 },
    ]);

    const queryVector = [0.1, 0.2, 0.3];
    const candidateIds = ["a", "b", "c"];
    const limit = 50;

    const out = await findSimilarProductsAmongCandidates(
      queryVector,
      candidateIds,
      limit,
    );

    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    const call = queryRawUnsafe.mock.calls[0];
    const sql = call[0] as string;

    // SQL shape per spec D7 (cosine <=>, ASC ordering, LIMIT param).
    expect(sql).toContain("p.id = ANY($2::text[])");
    expect(sql).toContain('p."embedding" <=> $1::vector');
    expect(sql).toContain("LIMIT $3");
    expect(sql).toContain("ORDER BY");

    // Positional params: $1 = vector literal string, $2 = id array,
    // $3 = limit number.
    expect(call[1]).toBe("[0.1,0.2,0.3]");
    expect(call[2]).toEqual(["a", "b", "c"]);
    expect(call[3]).toBe(50);

    // Returns the rows in helper-order with distance values intact.
    expect(out).toEqual([
      { id: "c", distance: 0.12 },
      { id: "a", distance: 0.34 },
      { id: "b", distance: 0.56 },
    ]);
  });

  it("returns N rows when the mock returns N (limit honored)", async () => {
    // Mock returns 2 rows; helper passes them through untruncated.
    // The Postgres-side LIMIT is asserted via the SQL+params shape
    // in the previous test; this one verifies the round-trip count.
    queryRawUnsafe.mockResolvedValue([
      { id: "x", distance: 0.1 },
      { id: "y", distance: 0.2 },
    ]);

    const out = await findSimilarProductsAmongCandidates(
      [0, 0, 0],
      ["x", "y", "z"],
      2,
    );

    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual(["x", "y"]);
    // Limit param passed through to the SQL call.
    expect(queryRawUnsafe.mock.calls[0][3]).toBe(2);
  });
});
