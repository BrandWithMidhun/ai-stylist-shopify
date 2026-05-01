// PR-D D.3: shouldEmitShortVisibilityWarn — read_all_orders scope
// clipping detector. End-of-run heuristic; one-shot per process.

import { describe, it, expect, beforeEach } from "vitest";
import {
  resetShortVisibilityWarnStateForTesting,
  shouldEmitShortVisibilityWarn,
} from "./short-visibility-warn.server";

const NOW = new Date("2026-05-02T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("shouldEmitShortVisibilityWarn", () => {
  beforeEach(() => {
    resetShortVisibilityWarnStateForTesting();
  });

  it("fires when 90d window asked but oldest order is at 58d (inside 55-65 band)", () => {
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 100,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: daysAgo(58),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it("does not fire when oldest order is at 30d (well inside the requested 90d window)", () => {
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 100,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: daysAgo(30),
      now: NOW,
    });
    expect(result).toBe(false);
  });

  it("does not fire on a zero-order shop (no signal to clip)", () => {
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 0,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: null,
      now: NOW,
    });
    expect(result).toBe(false);
  });

  it("fires only once across repeated invocations in the same process", () => {
    const input = {
      totalOrdersFetched: 100,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: daysAgo(60),
      now: NOW,
    };
    expect(shouldEmitShortVisibilityWarn(input)).toBe(true);
    expect(shouldEmitShortVisibilityWarn(input)).toBe(false);
    expect(shouldEmitShortVisibilityWarn(input)).toBe(false);
  });

  it("does not fire when configured window is at or below the 60-day threshold", () => {
    // No clipping is possible if we never asked for more than what
    // Shopify shows by default.
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 100,
      configuredWindowDays: 60,
      minOrderCreatedAtSeen: daysAgo(58),
      now: NOW,
    });
    expect(result).toBe(false);
  });

  it("does not fire when oldest order is older than 65 days (read_all_orders likely available)", () => {
    // Shopify returned an order from 75 days ago — that means the
    // 60-day clip is NOT in effect, so the symptom doesn't hold.
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 100,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: daysAgo(75),
      now: NOW,
    });
    expect(result).toBe(false);
  });

  it("does not fire when minOrderCreatedAtSeen is null despite non-zero totalOrdersFetched", () => {
    // Defensive: caller failed to populate min; we'd rather skip the
    // warn than call shouldEmit with stale-or-missing data.
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 100,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: null,
      now: NOW,
    });
    expect(result).toBe(false);
  });

  it("fires at the 55-day lower edge", () => {
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 100,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: daysAgo(55),
      now: NOW,
    });
    expect(result).toBe(true);
  });

  it("fires at the 65-day upper edge", () => {
    const result = shouldEmitShortVisibilityWarn({
      totalOrdersFetched: 100,
      configuredWindowDays: 90,
      minOrderCreatedAtSeen: daysAgo(65),
      now: NOW,
    });
    expect(result).toBe(true);
  });
});
