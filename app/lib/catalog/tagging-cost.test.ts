// PR-2.1: unit tests for tagging-cost.server.
//
// Strategy: computeCostFromUsage is a pure function and tested
// directly. The budget functions (checkBudgetForKind,
// writeBudgetWarningIfCrossed, resetBudgetTripwiresForNewDay) hit
// prisma, so we mock the prisma client via vi.mock. The mock surfaces
// the minimum subset of the prisma API these functions exercise.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the prisma client BEFORE importing tagging-cost so the import
// resolves to our fake. vi.hoisted() puts the mock objects at the top
// of the module so the vi.mock factory (which is itself hoisted) can
// reference them safely.
const { mockTaggingJob, mockMerchantConfig, mockTransaction } = vi.hoisted(() => {
  const taggingJob = {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const merchantConfig = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ merchantConfig, taggingJob }),
  );
  return {
    mockTaggingJob: taggingJob,
    mockMerchantConfig: merchantConfig,
    mockTransaction: transaction,
  };
});

vi.mock("../../db.server", () => ({
  default: {
    taggingJob: mockTaggingJob,
    merchantConfig: mockMerchantConfig,
    $transaction: mockTransaction,
  },
}));

import {
  checkBudgetForKind,
  computeCostFromUsage,
  resetBudgetTripwiresForNewDay,
  writeBudgetWarningIfCrossed,
} from "./tagging-cost.server";

beforeEach(() => {
  mockTaggingJob.findMany.mockReset();
  mockTaggingJob.findFirst.mockReset();
  mockTaggingJob.update.mockReset();
  mockTaggingJob.updateMany.mockReset();
  mockMerchantConfig.findUnique.mockReset();
  mockMerchantConfig.update.mockReset();
});

describe("computeCostFromUsage", () => {
  it("computes Sonnet 4.6 cost from input + output tokens", () => {
    // Sonnet 4.6: $3 input / Mtok = 3 micros/token; $15 output = 15 micros/token.
    // 1000 input + 500 output = 3000 + 7500 = 10500 micros = $0.0105.
    const r = computeCostFromUsage("claude-sonnet-4-6", 1000, 500);
    expect(r.costMicros).toBe(10_500n);
    expect(r.rateSource).toBe("known");
  });

  it("computes Sonnet 4.5 cost identical to 4.6 (same base rates)", () => {
    const r = computeCostFromUsage("claude-sonnet-4-5", 1000, 500);
    expect(r.costMicros).toBe(10_500n);
    expect(r.rateSource).toBe("known");
  });

  it("falls back to Sonnet rates when model is unknown", () => {
    const r = computeCostFromUsage("claude-haiku-4-5", 1000, 500);
    // Haiku is NOT in MODEL_RATES (PR-2.1 ships Sonnet only). Falls
    // back to Sonnet rates so the ledger never silently zeroes.
    expect(r.costMicros).toBe(10_500n);
    expect(r.rateSource).toBe("fallback");
  });

  it("clamps negative tokens to zero", () => {
    const r = computeCostFromUsage("claude-sonnet-4-6", -10, -5);
    expect(r.costMicros).toBe(0n);
  });

  it("truncates fractional tokens", () => {
    // Anthropic returns integer tokens, but defensively we trunc.
    const r = computeCostFromUsage("claude-sonnet-4-6", 1000.7, 500.3);
    expect(r.costMicros).toBe(10_500n);
  });
});

describe("checkBudgetForKind", () => {
  it("routes SINGLE_PRODUCT to the daily cap", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([
      { costUsdMicros: 100_000n }, // $0.10
      { costUsdMicros: 200_000n }, // $0.20
    ]);
    const r = await checkBudgetForKind({
      shopDomain: "test.shop",
      kind: "SINGLE_PRODUCT",
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.cumulativeMicros).toBe(300_000n);
      expect(r.capMicros).toBe(500_000n); // default $0.50
    }
  });

  it("routes MANUAL_RETAG to the daily cap", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([]);
    const r = await checkBudgetForKind({
      shopDomain: "test.shop",
      kind: "MANUAL_RETAG",
    });
    expect(r.allowed).toBe(true);
  });

  it("denies when daily cap is reached", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([
      { costUsdMicros: 500_000n }, // exactly at $0.50 cap
    ]);
    const r = await checkBudgetForKind({
      shopDomain: "test.shop",
      kind: "SINGLE_PRODUCT",
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe("DAILY_CAP");
    }
  });

  it("routes INITIAL_BACKFILL to the backfill cap (not daily)", async () => {
    mockTaggingJob.findFirst.mockResolvedValueOnce({
      costUsdMicros: 1_000_000n, // $1
    });
    const r = await checkBudgetForKind({
      shopDomain: "test.shop",
      kind: "INITIAL_BACKFILL",
    });
    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.capMicros).toBe(10_000_000n); // default $10
    }
    // Verify it queried the backfill row, not the daily aggregate.
    expect(mockTaggingJob.findFirst).toHaveBeenCalled();
    expect(mockTaggingJob.findMany).not.toHaveBeenCalled();
  });

  it("denies INITIAL_BACKFILL when backfill cap is reached", async () => {
    mockTaggingJob.findFirst.mockResolvedValueOnce({
      costUsdMicros: 10_000_000n, // exactly at $10 cap
    });
    const r = await checkBudgetForKind({
      shopDomain: "test.shop",
      kind: "INITIAL_BACKFILL",
    });
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.reason).toBe("BACKFILL_CAP");
    }
  });
});

describe("writeBudgetWarningIfCrossed", () => {
  it("returns 'none' when below 80% threshold", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([
      { costUsdMicros: 100_000n }, // 20% of $0.50
    ]);
    mockMerchantConfig.findUnique.mockResolvedValueOnce({
      taggingBudgetWarnedAt: null,
      taggingBudgetExceededAt: null,
    });
    const r = await writeBudgetWarningIfCrossed({ shopDomain: "test.shop" });
    expect(r.kind).toBe("none");
    expect(mockMerchantConfig.update).not.toHaveBeenCalled();
  });

  it("writes WARNED timestamp at 80% threshold", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([
      { costUsdMicros: 400_000n }, // exactly 80% of $0.50
    ]);
    mockMerchantConfig.findUnique.mockResolvedValueOnce({
      taggingBudgetWarnedAt: null,
      taggingBudgetExceededAt: null,
    });
    const r = await writeBudgetWarningIfCrossed({ shopDomain: "test.shop" });
    expect(r.kind).toBe("warn");
    if (r.kind === "warn") {
      expect(r.fraction).toBeCloseTo(0.8);
    }
    expect(mockMerchantConfig.update).toHaveBeenCalledOnce();
  });

  it("writes EXCEEDED + flips paused at 100% threshold", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([
      { costUsdMicros: 500_000n }, // exactly 100% of $0.50
    ]);
    mockMerchantConfig.findUnique.mockResolvedValueOnce({
      taggingBudgetWarnedAt: null,
      taggingBudgetExceededAt: null,
    });
    const r = await writeBudgetWarningIfCrossed({ shopDomain: "test.shop" });
    expect(r.kind).toBe("pause");
    expect(mockTransaction).toHaveBeenCalled();
  });

  it("is idempotent: re-crossing 80% on same day is a no-op", async () => {
    mockTaggingJob.findMany.mockResolvedValueOnce([
      { costUsdMicros: 400_000n },
    ]);
    mockMerchantConfig.findUnique.mockResolvedValueOnce({
      taggingBudgetWarnedAt: new Date(), // already warned today
      taggingBudgetExceededAt: null,
    });
    const r = await writeBudgetWarningIfCrossed({ shopDomain: "test.shop" });
    expect(r.kind).toBe("none");
    expect(mockMerchantConfig.update).not.toHaveBeenCalled();
  });
});

describe("resetBudgetTripwiresForNewDay", () => {
  it("clears tripwires set on a prior day", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockMerchantConfig.findUnique.mockResolvedValueOnce({
      taggingBudgetWarnedAt: yesterday,
      taggingBudgetExceededAt: yesterday,
    });
    const r = await resetBudgetTripwiresForNewDay("test.shop");
    expect(r.reset).toBe(true);
    expect(mockMerchantConfig.update).toHaveBeenCalledOnce();
  });

  it("does not clear tripwires set today", async () => {
    mockMerchantConfig.findUnique.mockResolvedValueOnce({
      taggingBudgetWarnedAt: new Date(),
      taggingBudgetExceededAt: null,
    });
    const r = await resetBudgetTripwiresForNewDay("test.shop");
    expect(r.reset).toBe(false);
    expect(mockMerchantConfig.update).not.toHaveBeenCalled();
  });

  it("no-ops when both tripwires are null", async () => {
    mockMerchantConfig.findUnique.mockResolvedValueOnce({
      taggingBudgetWarnedAt: null,
      taggingBudgetExceededAt: null,
    });
    const r = await resetBudgetTripwiresForNewDay("test.shop");
    expect(r.reset).toBe(false);
  });

  it("no-ops when MerchantConfig row does not exist", async () => {
    mockMerchantConfig.findUnique.mockResolvedValueOnce(null);
    const r = await resetBudgetTripwiresForNewDay("test.shop");
    expect(r.reset).toBe(false);
  });
});
