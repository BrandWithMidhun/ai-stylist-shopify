// PR-D D.2: unit tests for the cron tick logic.
//
// Strategy: mock enqueueDeltaForShop + refreshShopTimezone via vi.mock
// so we test the runCronTick scheduling logic in isolation, without
// hitting Prisma or Shopify. Prisma calls are stubbed via a hand-rolled
// fake matching the subset of methods runCronTick uses.
//
// Tests cover:
//   - In-window enqueue (localHour matches CRON_HOUR, not already today)
//   - In-window skip when lastCronEnqueueDate already matches today
//   - Out-of-window skip
//   - forceNextTick fires once then resets
//   - Per-shop error isolation (one bad shop doesn't poison the loop)
//   - Multi-shop multi-timezone: correct gating per local hour
//   - computeLocalHourAndDate: pure helper

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeLocalHourAndDate,
  runCronTick,
  __resetForceNextTickForTesting,
} from "./cron-tick.server";

vi.mock("../lib/webhooks/enqueue-delta.server", () => ({
  enqueueDeltaForShop: vi.fn(async () => ({
    jobId: "job-mock",
    deduped: false,
  })),
}));

vi.mock("../lib/cron/timezone-refresh.server", () => ({
  refreshShopTimezone: vi.fn(async (shop: string) => ({
    shopDomain: shop,
    ianaTimezone: null,
    changed: false,
  })),
}));

// PR-3.1.6-mech.2: scanner backstop is invoked from the per-shop loop.
// Mocked so cron-tick tests don't need a fully-fleshed prisma.product
// fake. The scanner itself is unit-tested separately in
// worker-null-hash-sweep.test.ts.
vi.mock("./worker-null-hash-sweep.server", () => ({
  runNullHashSweep: vi.fn(async (_prisma: unknown, shopDomain: string) => ({
    shopDomain,
    eligibleCount: 0,
    enqueuedCount: 0,
    alreadyQueuedCount: 0,
    durationMs: 0,
  })),
}));

// Avoid emitting structured logs during tests.
vi.mock("./worker-logger", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { enqueueDeltaForShop } from "../lib/webhooks/enqueue-delta.server";
import { refreshShopTimezone } from "../lib/cron/timezone-refresh.server";
import { runNullHashSweep } from "./worker-null-hash-sweep.server";

type FakeMerchantConfig = {
  shop: string;
  timezone: string;
  timezoneSyncedAt: Date | null;
  lastCronEnqueueDate: Date | null;
};

function makePrisma(configs: FakeMerchantConfig[]) {
  const updates: Array<{ shop: string; data: Record<string, unknown> }> = [];
  return {
    updates,
    prisma: {
      merchantConfig: {
        findMany: async () => configs,
        update: async (args: { where: { shop: string }; data: unknown }) => {
          const data = args.data as Record<string, unknown>;
          updates.push({ shop: args.where.shop, data });
          // Mutate the underlying config so subsequent ticks see the
          // stamped lastCronEnqueueDate / refreshed timezone — closer
          // to real Prisma behavior than a no-op update.
          const target = configs.find((c) => c.shop === args.where.shop);
          if (target) {
            if ("lastCronEnqueueDate" in data) {
              target.lastCronEnqueueDate = data.lastCronEnqueueDate as Date;
            }
            if ("timezone" in data) {
              target.timezone = data.timezone as string;
            }
            if ("timezoneSyncedAt" in data) {
              target.timezoneSyncedAt = data.timezoneSyncedAt as Date;
            }
          }
          return null;
        },
        findUnique: async () => null,
      },
    } as unknown as Parameters<typeof runCronTick>[0],
  };
}

describe("computeLocalHourAndDate", () => {
  it("computes IST hour for a known UTC instant", () => {
    // 2026-05-01 21:30 UTC = 2026-05-02 03:00 IST
    const utc = new Date("2026-05-01T21:30:00.000Z");
    const { localHour, localDate } = computeLocalHourAndDate(
      utc,
      "Asia/Kolkata",
    );
    expect(localHour).toBe(3);
    expect(localDate).toBe("2026-05-02");
  });

  it("computes UTC hour for the UTC timezone", () => {
    const utc = new Date("2026-05-01T03:00:00.000Z");
    const { localHour, localDate } = computeLocalHourAndDate(utc, "UTC");
    expect(localHour).toBe(3);
    expect(localDate).toBe("2026-05-01");
  });

  it("handles midnight wrap correctly", () => {
    // 2026-05-01 23:30 UTC = 2026-05-01 19:30 EST
    const utc = new Date("2026-05-01T23:30:00.000Z");
    const { localHour, localDate } = computeLocalHourAndDate(
      utc,
      "America/New_York",
    );
    expect(localHour).toBe(19);
    expect(localDate).toBe("2026-05-01");
  });
});

describe("runCronTick", () => {
  beforeEach(() => {
    vi.mocked(enqueueDeltaForShop).mockClear();
    vi.mocked(refreshShopTimezone).mockClear();
    vi.mocked(runNullHashSweep).mockClear();
    __resetForceNextTickForTesting(false);
    delete process.env.CRON_HOUR;
  });

  it("enqueues DELTA when localHour matches CRON_HOUR and not already today", async () => {
    const { prisma, updates } = makePrisma([
      {
        shop: "test.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    // 2026-05-01 03:00 UTC — local hour 3 in UTC tz, default CRON_HOUR=3
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T03:00:00.000Z"),
    );
    expect(result.enqueuedShops).toBe(1);
    expect(result.skippedAlreadyEnqueued).toBe(0);
    expect(result.skippedOutOfWindow).toBe(0);
    expect(enqueueDeltaForShop).toHaveBeenCalledWith(
      "test.myshopify.com",
      expect.objectContaining({ topic: "cron", triggerSource: "CRON" }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].data.lastCronEnqueueDate).toBeInstanceOf(Date);
  });

  it("skips enqueue when lastCronEnqueueDate already matches today", async () => {
    const { prisma } = makePrisma([
      {
        shop: "test.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        // Already enqueued for 2026-05-01.
        lastCronEnqueueDate: new Date("2026-05-01T00:00:00.000Z"),
      },
    ]);
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T03:00:00.000Z"),
    );
    expect(result.enqueuedShops).toBe(0);
    expect(result.skippedAlreadyEnqueued).toBe(1);
    expect(enqueueDeltaForShop).not.toHaveBeenCalled();
  });

  it("skips enqueue when localHour is outside the window", async () => {
    const { prisma } = makePrisma([
      {
        shop: "test.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    // 2026-05-01 14:00 UTC — local hour 14 != 3
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T14:00:00.000Z"),
    );
    expect(result.enqueuedShops).toBe(0);
    expect(result.skippedOutOfWindow).toBe(1);
    expect(enqueueDeltaForShop).not.toHaveBeenCalled();
  });

  it("forceNextTick fires regardless of hour, then resets", async () => {
    __resetForceNextTickForTesting(true);
    const { prisma } = makePrisma([
      {
        shop: "test.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    // 2026-05-01 14:00 UTC — out-of-window, but force overrides
    const first = await runCronTick(
      prisma,
      new Date("2026-05-01T14:00:00.000Z"),
    );
    expect(first.enqueuedShops).toBe(1);
    expect(enqueueDeltaForShop).toHaveBeenCalledTimes(1);

    // Same time, second tick — flag should have reset, normal gating
    // applies. The local hour 14 is now out-of-window (CRON_HOUR=3),
    // and lastCronEnqueueDate has been stamped from the force tick,
    // so the shop is BOTH already-enqueued AND out-of-window. The
    // out-of-window check happens first, so it lands in that bucket.
    const second = await runCronTick(
      prisma,
      new Date("2026-05-01T14:00:00.000Z"),
    );
    expect(second.enqueuedShops).toBe(0);
    expect(second.skippedOutOfWindow).toBe(1);
    expect(enqueueDeltaForShop).toHaveBeenCalledTimes(1);
  });

  it("isolates per-shop errors so one bad row doesn't poison the loop", async () => {
    vi.mocked(enqueueDeltaForShop)
      .mockRejectedValueOnce(new Error("synthetic failure"))
      .mockResolvedValueOnce({ jobId: "job-2", deduped: false });
    const { prisma } = makePrisma([
      {
        shop: "broken.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
      {
        shop: "good.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T03:00:00.000Z"),
    );
    expect(result.errors).toBe(1);
    expect(result.enqueuedShops).toBe(1);
    expect(enqueueDeltaForShop).toHaveBeenCalledTimes(2);
  });

  it("gates each shop against its own local hour, not UTC hour", async () => {
    const { prisma } = makePrisma([
      {
        // 2026-05-01 21:30 UTC = 2026-05-02 03:00 IST → in window
        shop: "ist.myshopify.com",
        timezone: "Asia/Kolkata",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
      {
        // 2026-05-01 21:30 UTC = 2026-05-01 17:30 EST → out of window
        shop: "est.myshopify.com",
        timezone: "America/New_York",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T21:30:00.000Z"),
    );
    expect(result.enqueuedShops).toBe(1);
    expect(result.skippedOutOfWindow).toBe(1);
    const calls = vi.mocked(enqueueDeltaForShop).mock.calls;
    expect(calls.map((c) => c[0])).toEqual(["ist.myshopify.com"]);
  });

  it("triggers timezone refresh when timezoneSyncedAt is stale", async () => {
    const old = new Date("2026-04-29T00:00:00.000Z"); // > 24h before tick
    const { prisma } = makePrisma([
      {
        shop: "stale.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: old,
        lastCronEnqueueDate: null,
      },
    ]);
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T14:00:00.000Z"),
    );
    expect(result.timezoneRefreshes).toBe(1);
    expect(refreshShopTimezone).toHaveBeenCalledWith(
      "stale.myshopify.com",
      expect.anything(),
    );
  });

  // PR-3.1.6-mech.2: NULL-hash scanner backstop wiring.
  it("invokes runNullHashSweep for each in-window shop after DELTA enqueue", async () => {
    const { prisma } = makePrisma([
      {
        shop: "in-window.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
      {
        shop: "out-of-window.myshopify.com",
        timezone: "America/New_York", // 22:00 ET at this UTC, out of cronHour=3
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    await runCronTick(prisma, new Date("2026-05-01T03:00:00.000Z"));

    // Scanner runs only for the in-window shop, not the out-of-window one.
    expect(runNullHashSweep).toHaveBeenCalledTimes(1);
    expect(runNullHashSweep).toHaveBeenCalledWith(
      expect.anything(),
      "in-window.myshopify.com",
    );
  });

  it("scanner failure does NOT prevent DELTA enqueue side effects (lastCronEnqueueDate stamped)", async () => {
    vi.mocked(runNullHashSweep).mockRejectedValueOnce(
      new Error("synthetic sweep failure"),
    );
    const { prisma, updates } = makePrisma([
      {
        shop: "test.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T03:00:00.000Z"),
    );

    // DELTA fired and lastCronEnqueueDate was stamped despite scanner throw.
    expect(result.enqueuedShops).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.lastCronEnqueueDate).toBeInstanceOf(Date);

    // Scanner failure is logged but does not increment per-shop errors
    // counter (different concern — DELTA succeeded).
    expect(result.errors).toBe(0);
  });

  it("scanner runs even if DELTA enqueue throws (Decision 8: independent concerns)", async () => {
    // First call throws, but scanner mock is independent and resolves cleanly.
    vi.mocked(enqueueDeltaForShop).mockRejectedValueOnce(
      new Error("synthetic DELTA failure"),
    );
    const { prisma } = makePrisma([
      {
        shop: "test.myshopify.com",
        timezone: "UTC",
        timezoneSyncedAt: new Date(),
        lastCronEnqueueDate: null,
      },
    ]);
    const result = await runCronTick(
      prisma,
      new Date("2026-05-01T03:00:00.000Z"),
    );

    // DELTA failure counted in errors.
    expect(result.errors).toBe(1);
    expect(result.enqueuedShops).toBe(0);

    // Scanner still ran — Decision 8 mandate.
    expect(runNullHashSweep).toHaveBeenCalledTimes(1);
    expect(runNullHashSweep).toHaveBeenCalledWith(
      expect.anything(),
      "test.myshopify.com",
    );
  });
});
