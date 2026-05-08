// PR-3.1.6-mech.1: tests for enqueueReembedForProduct.
// PR-3.1.6-mech.3: tests for triggerReembedOnUnexclude added below.
//
// vi.hoisted-mocked prisma + logger. Asserts:
//   enqueueReembedForProduct (mech.1, 4 tests):
//     1. No existing QUEUED RE_EMBED → creates new row, deduped=false.
//     2. Existing QUEUED RE_EMBED → returns its id, deduped=true.
//     3. P2002 race-loss → returns winner with deduped=true.
//     4. P2002 with no kind-specific winner → rethrows.
//   triggerReembedOnUnexclude (mech.3, 4 tests):
//     5. (true → false) transition → enqueue called with UNEXCLUDE.
//     6. (false → true) re-exclude → no enqueue.
//     7. (false → false) no-change → no enqueue.
//     8. enqueue throws → logged at error level, function does not throw.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { taggingJobFindFirst, taggingJobCreate, mockLog } = vi.hoisted(() => ({
  taggingJobFindFirst: vi.fn(),
  taggingJobCreate: vi.fn(),
  mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../db.server", () => ({
  default: {
    taggingJob: {
      findFirst: taggingJobFindFirst,
      create: taggingJobCreate,
    },
  },
}));

vi.mock("../../server/worker-logger", () => ({ log: mockLog }));

import {
  enqueueReembedForProduct,
  triggerReembedOnUnexclude,
} from "./enqueue-reembed.server";

beforeEach(() => {
  taggingJobFindFirst.mockReset();
  taggingJobCreate.mockReset();
  mockLog.info.mockReset();
  mockLog.error.mockReset();
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

describe("triggerReembedOnUnexclude (mech.3)", () => {
  it("enqueues RE_EMBED with triggerSource=UNEXCLUDE on (true → false) transition", async () => {
    // findFirst returns null (no existing QUEUED RE_EMBED), then create succeeds.
    taggingJobFindFirst.mockResolvedValueOnce(null);
    taggingJobCreate.mockResolvedValueOnce({ id: "reembed-job-1" });

    await triggerReembedOnUnexclude({
      shopDomain: "test.shop",
      productId: "prod-1",
      prior: { recommendationExcluded: true },
      incoming: { excluded: false },
    });

    expect(taggingJobCreate).toHaveBeenCalledTimes(1);
    const createCall = taggingJobCreate.mock.calls[0][0];
    expect(createCall.data).toMatchObject({
      shopDomain: "test.shop",
      productId: "prod-1",
      kind: "RE_EMBED",
      status: "QUEUED",
      triggerSource: "UNEXCLUDE",
    });
    expect(mockLog.info).toHaveBeenCalledOnce();
    expect(mockLog.info.mock.calls[0][1]).toMatchObject({
      event: "reembed_enqueued_from_unexclude",
      shopDomain: "test.shop",
      productId: "prod-1",
      reembedJobId: "reembed-job-1",
      deduped: false,
    });
  });

  it("does NOT enqueue on (false → true) re-exclude transition", async () => {
    await triggerReembedOnUnexclude({
      shopDomain: "test.shop",
      productId: "prod-1",
      prior: { recommendationExcluded: false },
      incoming: { excluded: true },
    });

    expect(taggingJobFindFirst).not.toHaveBeenCalled();
    expect(taggingJobCreate).not.toHaveBeenCalled();
    expect(mockLog.info).not.toHaveBeenCalled();
  });

  it("does NOT enqueue on (false → false) no-change", async () => {
    await triggerReembedOnUnexclude({
      shopDomain: "test.shop",
      productId: "prod-1",
      prior: { recommendationExcluded: false },
      incoming: { excluded: false },
    });

    expect(taggingJobFindFirst).not.toHaveBeenCalled();
    expect(taggingJobCreate).not.toHaveBeenCalled();
  });

  it("does NOT enqueue on (true → true) no-change (e.g. UI sent same value)", async () => {
    await triggerReembedOnUnexclude({
      shopDomain: "test.shop",
      productId: "prod-1",
      prior: { recommendationExcluded: true },
      incoming: { excluded: true },
    });

    expect(taggingJobFindFirst).not.toHaveBeenCalled();
    expect(taggingJobCreate).not.toHaveBeenCalled();
  });

  it("logs at error level and does NOT throw when enqueue fails", async () => {
    // findFirst returns null then create rejects (simulating a DB-down scenario)
    taggingJobFindFirst.mockResolvedValueOnce(null);
    taggingJobCreate.mockRejectedValueOnce(new Error("synthetic db failure"));

    await expect(
      triggerReembedOnUnexclude({
        shopDomain: "test.shop",
        productId: "prod-1",
        prior: { recommendationExcluded: true },
        incoming: { excluded: false },
      }),
    ).resolves.toBeUndefined();

    expect(mockLog.error).toHaveBeenCalledOnce();
    expect(mockLog.error.mock.calls[0][1]).toMatchObject({
      event: "reembed_enqueue_error_unexclude",
      shopDomain: "test.shop",
      productId: "prod-1",
      message: "synthetic db failure",
    });
  });
});
