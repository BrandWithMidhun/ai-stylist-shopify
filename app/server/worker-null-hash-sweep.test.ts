// PR-3.1.6-mech.2: tests for runNullHashSweep.
//
// Mocks enqueueReembedForProduct (via vi.hoisted) and a hand-rolled prisma
// stub matching the subset runNullHashSweep uses (product.findMany).
// Asserts: empty result on no eligible, enqueue-all on eligible,
// dedup-counted, per-product failure isolation.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueueReembedMock, mockLog } = vi.hoisted(() => ({
  enqueueReembedMock: vi.fn(),
  mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/catalog/enqueue-reembed.server", () => ({
  enqueueReembedForProduct: enqueueReembedMock,
}));

vi.mock("./worker-logger", () => ({ log: mockLog }));

import { runNullHashSweep } from "./worker-null-hash-sweep.server";

function makePrisma(eligible: Array<{ id: string }>) {
  return {
    product: {
      findMany: vi.fn(async () => eligible),
    },
  } as unknown as Parameters<typeof runNullHashSweep>[0];
}

beforeEach(() => {
  enqueueReembedMock.mockReset();
  mockLog.info.mockReset();
  mockLog.error.mockReset();
});

describe("runNullHashSweep", () => {
  it("returns zero counts and emits log when no eligible products", async () => {
    const prisma = makePrisma([]);
    const result = await runNullHashSweep(prisma, "test.shop");

    expect(result.shopDomain).toBe("test.shop");
    expect(result.eligibleCount).toBe(0);
    expect(result.enqueuedCount).toBe(0);
    expect(result.alreadyQueuedCount).toBe(0);
    expect(typeof result.durationMs).toBe("number");
    expect(enqueueReembedMock).not.toHaveBeenCalled();
    expect(mockLog.info).toHaveBeenCalledOnce();
    expect(mockLog.info.mock.calls[0][1]).toMatchObject({
      event: "null_hash_sweep_evaluated",
      shopDomain: "test.shop",
      eligibleCount: 0,
    });
  });

  it("enqueues RE_EMBED for each eligible product with triggerSource=NULL_HASH_SWEEP", async () => {
    const prisma = makePrisma([
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ]);
    enqueueReembedMock.mockResolvedValue({ jobId: "job-X", deduped: false });

    const result = await runNullHashSweep(prisma, "test.shop");

    expect(result.eligibleCount).toBe(3);
    expect(result.enqueuedCount).toBe(3);
    expect(result.alreadyQueuedCount).toBe(0);
    expect(enqueueReembedMock).toHaveBeenCalledTimes(3);
    expect(enqueueReembedMock).toHaveBeenNthCalledWith(1, {
      shopDomain: "test.shop",
      productId: "p1",
      triggerSource: "NULL_HASH_SWEEP",
    });
  });

  it("counts deduped enqueues as alreadyQueuedCount, not enqueuedCount", async () => {
    const prisma = makePrisma([
      { id: "p1" },
      { id: "p2" },
      { id: "p3" },
    ]);
    enqueueReembedMock
      .mockResolvedValueOnce({ jobId: "job-1", deduped: false })
      .mockResolvedValueOnce({ jobId: "job-existing", deduped: true })
      .mockResolvedValueOnce({ jobId: "job-3", deduped: false });

    const result = await runNullHashSweep(prisma, "test.shop");

    expect(result.eligibleCount).toBe(3);
    expect(result.enqueuedCount).toBe(2);
    expect(result.alreadyQueuedCount).toBe(1);
  });

  it("logs and continues on per-product enqueue failure (does not abort sweep)", async () => {
    const prisma = makePrisma([
      { id: "p-good-1" },
      { id: "p-bad" },
      { id: "p-good-2" },
    ]);
    enqueueReembedMock
      .mockResolvedValueOnce({ jobId: "job-1", deduped: false })
      .mockRejectedValueOnce(new Error("synthetic enqueue failure"))
      .mockResolvedValueOnce({ jobId: "job-3", deduped: false });

    const result = await runNullHashSweep(prisma, "test.shop");

    expect(result.eligibleCount).toBe(3);
    expect(result.enqueuedCount).toBe(2);
    expect(result.alreadyQueuedCount).toBe(0);
    expect(enqueueReembedMock).toHaveBeenCalledTimes(3);
    expect(mockLog.error).toHaveBeenCalledOnce();
    expect(mockLog.error.mock.calls[0][1]).toMatchObject({
      event: "null_hash_sweep_enqueue_error",
      shopDomain: "test.shop",
      productId: "p-bad",
      message: "synthetic enqueue failure",
    });
  });
});
