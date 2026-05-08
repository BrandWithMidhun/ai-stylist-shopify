// PR-3.1.6-mech.1: tests for enqueueReembedForProduct.
//
// vi.hoisted-mocked prisma. Asserts the four behaviors:
//   1. No existing QUEUED RE_EMBED → creates new row, deduped=false.
//   2. Existing QUEUED RE_EMBED → returns its id, deduped=true.
//   3. Existing QUEUED non-RE_EMBED (different kind) → still treated as
//      no-existing, helper inserts; the kind-aware dedup is the point.
//   4. P2002 race-loss → if winner is a RE_EMBED, returns deduped=true;
//      if winner is a different kind (no kind-specific winner found),
//      the function rethrows.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { taggingJobFindFirst, taggingJobCreate } = vi.hoisted(() => ({
  taggingJobFindFirst: vi.fn(),
  taggingJobCreate: vi.fn(),
}));

vi.mock("../../db.server", () => ({
  default: {
    taggingJob: {
      findFirst: taggingJobFindFirst,
      create: taggingJobCreate,
    },
  },
}));

import { enqueueReembedForProduct } from "./enqueue-reembed.server";

beforeEach(() => {
  taggingJobFindFirst.mockReset();
  taggingJobCreate.mockReset();
});

describe("enqueueReembedForProduct", () => {
  it("creates a new RE_EMBED row when none is queued", async () => {
    taggingJobFindFirst.mockResolvedValueOnce(null);
    taggingJobCreate.mockResolvedValueOnce({ id: "job-NEW" });

    const result = await enqueueReembedForProduct({
      shopDomain: "test.shop",
      productId: "prod-1",
      triggerSource: "TAGGING_COMPLETION",
    });

    expect(result).toEqual({ jobId: "job-NEW", deduped: false });
    expect(taggingJobCreate).toHaveBeenCalledTimes(1);
    const createCall = taggingJobCreate.mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      shopDomain: "test.shop",
      productId: "prod-1",
      kind: "RE_EMBED",
      status: "QUEUED",
      triggerSource: "TAGGING_COMPLETION",
    });
  });

  it("returns existing jobId when a RE_EMBED is already QUEUED", async () => {
    taggingJobFindFirst.mockResolvedValueOnce({
      id: "job-EXISTING",
      kind: "RE_EMBED",
      status: "QUEUED",
    });

    const result = await enqueueReembedForProduct({
      shopDomain: "test.shop",
      productId: "prod-1",
      triggerSource: "TAGGING_COMPLETION",
    });

    expect(result).toEqual({ jobId: "job-EXISTING", deduped: true });
    expect(taggingJobCreate).not.toHaveBeenCalled();
  });

  it("recovers from P2002 race-loss by returning the RE_EMBED winner", async () => {
    // First findFirst (pre-insert dedup) returns null — no winner yet.
    // Insert raises P2002 (parallel insert won the partial-unique race).
    // Second findFirst (post-P2002 recovery) finds the RE_EMBED winner.
    taggingJobFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "job-WINNER", kind: "RE_EMBED", status: "QUEUED" });
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    taggingJobCreate.mockRejectedValueOnce(p2002);

    const result = await enqueueReembedForProduct({
      shopDomain: "test.shop",
      productId: "prod-1",
      triggerSource: "TAGGING_COMPLETION",
    });

    expect(result).toEqual({ jobId: "job-WINNER", deduped: true });
    expect(taggingJobFindFirst).toHaveBeenCalledTimes(2);
  });

  it("rethrows on P2002 when no RE_EMBED winner exists (different-kind conflict)", async () => {
    // Pre-insert dedup finds nothing.
    // Insert raises P2002 (a different-kind QUEUED row holds the index slot).
    // Post-recovery findFirst (RE_EMBED-only) also returns null.
    taggingJobFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    taggingJobCreate.mockRejectedValueOnce(p2002);

    await expect(
      enqueueReembedForProduct({
        shopDomain: "test.shop",
        productId: "prod-1",
        triggerSource: "TAGGING_COMPLETION",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
