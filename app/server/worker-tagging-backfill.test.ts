// PR-2.2: unit tests for the INITIAL_BACKFILL handler.
//
// Strategy: mock prisma + ai-tagger.generateTagsForProductById +
// tagging-cost helpers via vi.hoisted. Exercise the handler against
// synthetic product lists.
//
// Coverage:
//   - empty active-product list → SUCCEEDED with 0/0/0
//   - normal multi-product run → iterates all, accumulates cost
//   - cursor resume from summary.lastProcessedProductId
//   - mid-product shouldStop check exits cleanly leaving job RUNNING
//   - per-product failure isolation (AUTH error increments failedProducts, continues)
//   - budget pause when cumulative cost crosses cap
//   - --limit N respected (handler exits after N iterations)

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockGenerateTags, mockHeartbeat, mockFinish, mockRecordCost, mockCheckBudget } =
  vi.hoisted(() => {
    return {
      mockPrisma: {
        product: {
          count: vi.fn(),
          findMany: vi.fn(),
        },
        taggingJob: {
          update: vi.fn(),
          findUnique: vi.fn(),
        },
      },
      mockGenerateTags: vi.fn(),
      mockHeartbeat: vi.fn(),
      mockFinish: vi.fn(),
      mockRecordCost: vi.fn(),
      mockCheckBudget: vi.fn(),
    };
  });

vi.mock("../db.server", () => ({ default: mockPrisma }));
vi.mock("../lib/catalog/ai-tagger.server", () => ({
  generateTagsForProductById: mockGenerateTags,
}));
vi.mock("../lib/catalog/tagging-jobs.server", () => ({
  finishTaggingJob: mockFinish,
  heartbeatTaggingJob: mockHeartbeat,
}));
vi.mock("../lib/catalog/tagging-cost.server", () => ({
  computeCostFromUsage: (_model: string, inT: number, outT: number) => ({
    costMicros: BigInt(inT * 3 + outT * 15),
    rateSource: "known" as const,
  }),
  getBackfillBudgetMicros: () => mockCheckBudget() ?? 10_000_000n,
  recordCost: mockRecordCost,
}));
vi.mock("./worker-logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processInitialBackfill } from "./worker-tagging-backfill";

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    shopDomain: "test.shop",
    productId: null,
    kind: "INITIAL_BACKFILL",
    status: "RUNNING",
    triggerSource: "INITIAL_BACKFILL",
    enqueuedAt: new Date("2026-05-03T00:00:00Z"),
    startedAt: new Date("2026-05-03T00:00:00Z"),
    finishedAt: null,
    heartbeatAt: new Date(),
    totalProducts: null,
    processedProducts: 0,
    failedProducts: 0,
    skippedProducts: 0,
    costUsdMicros: 0n,
    inputTokens: 0,
    outputTokens: 0,
    errorClass: null,
    errorMessage: null,
    summary: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as never; // cast to TaggingJob via test surface
}

beforeEach(() => {
  for (const fn of [
    mockPrisma.product.count,
    mockPrisma.product.findMany,
    mockPrisma.taggingJob.update,
    mockPrisma.taggingJob.findUnique,
    mockGenerateTags,
    mockHeartbeat,
    mockFinish,
    mockRecordCost,
    mockCheckBudget,
  ]) {
    fn.mockReset();
  }
  mockCheckBudget.mockReturnValue(10_000_000n); // default $10 cap
});

describe("processInitialBackfill", () => {
  it("empty product list completes immediately as SUCCEEDED", async () => {
    mockPrisma.product.count.mockResolvedValueOnce(0);
    mockPrisma.product.findMany.mockResolvedValueOnce([]);
    mockPrisma.taggingJob.update.mockResolvedValue({});
    mockFinish.mockResolvedValue(undefined);

    const r = await processInitialBackfill({
      job: makeJob(),
      shouldStop: () => false,
    });

    expect(r.outcome).toBe("succeeded");
    expect(r.processed).toBe(0);
    expect(r.failed).toBe(0);
    expect(mockGenerateTags).not.toHaveBeenCalled();
    expect(mockFinish).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "SUCCEEDED" }),
    );
  });

  it("iterates all products and records cost per call", async () => {
    mockPrisma.product.count.mockResolvedValueOnce(3);
    mockPrisma.product.findMany
      .mockResolvedValueOnce([{ id: "p1" }, { id: "p2" }, { id: "p3" }])
      .mockResolvedValueOnce([]);
    mockPrisma.taggingJob.update.mockResolvedValue({});
    mockFinish.mockResolvedValue(undefined);
    mockGenerateTags.mockResolvedValue({
      ok: true,
      tags: [],
      writtenCount: 1,
      inputTokens: 100,
      outputTokens: 50,
      model: "claude-sonnet-4-6",
      axesNeeded: [],
      ruleTagsWritten: 0,
    });

    const r = await processInitialBackfill({
      job: makeJob(),
      shouldStop: () => false,
    });

    expect(r.outcome).toBe("succeeded");
    expect(r.processed).toBe(3);
    expect(r.failed).toBe(0);
    expect(mockGenerateTags).toHaveBeenCalledTimes(3);
    expect(mockRecordCost).toHaveBeenCalledTimes(3);
    expect(mockHeartbeat).toHaveBeenCalledTimes(3);
  });

  it("resumes from summary.lastProcessedProductId cursor", async () => {
    mockPrisma.product.count.mockResolvedValueOnce(5);
    // Cursor at p2; expect findMany called with id > p2 → returns p3..p5
    mockPrisma.product.findMany
      .mockResolvedValueOnce([{ id: "p3" }, { id: "p4" }, { id: "p5" }])
      .mockResolvedValueOnce([]);
    mockPrisma.taggingJob.update.mockResolvedValue({});
    mockFinish.mockResolvedValue(undefined);
    mockGenerateTags.mockResolvedValue({
      ok: true, tags: [], writtenCount: 1, inputTokens: 50, outputTokens: 25,
      model: "claude-sonnet-4-6", axesNeeded: [], ruleTagsWritten: 0,
    });

    await processInitialBackfill({
      job: makeJob({
        processedProducts: 2,
        summary: {
          kind: "INITIAL_BACKFILL",
          lastProcessedProductId: "p2",
          totalProducts: 5,
        },
      }),
      shouldStop: () => false,
    });

    const findManyCall = mockPrisma.product.findMany.mock.calls[0][0];
    expect(findManyCall.where.id).toEqual({ gt: "p2" });
    expect(mockGenerateTags).toHaveBeenCalledTimes(3);
  });

  it("exits cleanly between products when shouldStop becomes true", async () => {
    mockPrisma.product.count.mockResolvedValueOnce(3);
    mockPrisma.product.findMany
      .mockResolvedValueOnce([{ id: "p1" }, { id: "p2" }, { id: "p3" }])
      .mockResolvedValueOnce([]);
    mockPrisma.taggingJob.update.mockResolvedValue({});
    mockGenerateTags.mockResolvedValue({
      ok: true, tags: [], writtenCount: 1, inputTokens: 100, outputTokens: 50,
      model: "claude-sonnet-4-6", axesNeeded: [], ruleTagsWritten: 0,
    });

    let calls = 0;
    const shouldStop = () => {
      calls += 1;
      return calls > 2; // true on 3rd check (after 1 product processed)
    };

    const r = await processInitialBackfill({
      job: makeJob(),
      shouldStop,
    });

    expect(r.outcome).toBe("shouldStop_exit");
    // shouldStop_exit means we don't call finishTaggingJob — leave row RUNNING
    expect(mockFinish).not.toHaveBeenCalled();
    // Should have processed at least one product before exiting
    expect(r.processed).toBeGreaterThanOrEqual(1);
  });

  it("isolates per-product AUTH failures and continues", async () => {
    mockPrisma.product.count.mockResolvedValueOnce(3);
    mockPrisma.product.findMany
      .mockResolvedValueOnce([{ id: "p1" }, { id: "p2" }, { id: "p3" }])
      .mockResolvedValueOnce([]);
    mockPrisma.taggingJob.update.mockResolvedValue({});
    mockFinish.mockResolvedValue(undefined);

    mockGenerateTags
      .mockResolvedValueOnce({
        ok: true, tags: [], writtenCount: 1, inputTokens: 100, outputTokens: 50,
        model: "claude-sonnet-4-6", axesNeeded: [], ruleTagsWritten: 0,
      })
      .mockResolvedValueOnce({
        ok: false,
        error: "Anthropic auth failed",
        errorClass: "AUTH",
        inputTokens: 0, outputTokens: 0, model: "claude-sonnet-4-6",
      })
      .mockResolvedValueOnce({
        ok: true, tags: [], writtenCount: 1, inputTokens: 100, outputTokens: 50,
        model: "claude-sonnet-4-6", axesNeeded: [], ruleTagsWritten: 0,
      });

    const r = await processInitialBackfill({
      job: makeJob(),
      shouldStop: () => false,
    });

    expect(r.outcome).toBe("succeeded");
    expect(r.processed).toBe(2);
    expect(r.failed).toBe(1);
    expect(mockFinish).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "SUCCEEDED" }),
    );
  });

  it("flips to BUDGET_PAUSED when cumulative cost crosses cap", async () => {
    // Use a tiny cap so the first ~25 products trip it.
    mockCheckBudget.mockReturnValue(50n); // 50 micros = ~$0.00005
    mockPrisma.product.count.mockResolvedValueOnce(50);
    const products = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }));
    mockPrisma.product.findMany
      .mockResolvedValueOnce(products)
      .mockResolvedValueOnce([]);
    mockPrisma.taggingJob.update.mockResolvedValue({});
    mockFinish.mockResolvedValue(undefined);
    // Each call costs 3*100 + 15*50 = 1050 micros, so any single call
    // already exceeds the 50-micro cap — should pause on first re-check.
    mockGenerateTags.mockResolvedValue({
      ok: true, tags: [], writtenCount: 1, inputTokens: 100, outputTokens: 50,
      model: "claude-sonnet-4-6", axesNeeded: [], ruleTagsWritten: 0,
    });
    // Re-fetched cost from row at the 25-product budget recheck.
    mockPrisma.taggingJob.findUnique.mockResolvedValue({
      costUsdMicros: 100_000n, // way over 50
    });

    const r = await processInitialBackfill({
      job: makeJob(),
      shouldStop: () => false,
    });

    expect(r.outcome).toBe("budget_paused");
    expect(mockFinish).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ status: "BUDGET_PAUSED" }),
    );
  });

  it("respects --limit N via summary.limit", async () => {
    mockPrisma.product.count.mockResolvedValueOnce(100);
    const products = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}` }));
    mockPrisma.product.findMany.mockResolvedValueOnce(products);
    mockPrisma.taggingJob.update.mockResolvedValue({});
    mockFinish.mockResolvedValue(undefined);
    mockGenerateTags.mockResolvedValue({
      ok: true, tags: [], writtenCount: 1, inputTokens: 50, outputTokens: 25,
      model: "claude-sonnet-4-6", axesNeeded: [], ruleTagsWritten: 0,
    });

    const r = await processInitialBackfill({
      job: makeJob({
        summary: { kind: "INITIAL_BACKFILL", limit: 5 },
      }),
      shouldStop: () => false,
    });

    expect(r.outcome).toBe("succeeded");
    expect(r.processed).toBe(5);
    expect(mockGenerateTags).toHaveBeenCalledTimes(5);
  });
});
