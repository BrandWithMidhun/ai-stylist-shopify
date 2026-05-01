// PR-D D.3: parsePriceToInt — minor-unit conversion for Shopify Money.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parsePriceToInt,
  resetPriceWarnStateForTesting,
} from "./price.server";

describe("parsePriceToInt", () => {
  it("converts a 2-decimal currency to cents", () => {
    expect(parsePriceToInt("29.95", "USD")).toBe(2995);
    expect(parsePriceToInt("0.05", "USD")).toBe(5);
    expect(parsePriceToInt("100", "USD")).toBe(10000);
    expect(parsePriceToInt("100.5", "USD")).toBe(10050);
  });

  it("rounds 2-decimal float noise correctly", () => {
    // 19.99 * 100 = 1998.9999999... in IEEE 754. Math.round must
    // bring this back to 1999.
    expect(parsePriceToInt("19.99", "USD")).toBe(1999);
    expect(parsePriceToInt("0.10", "USD")).toBe(10);
  });

  it("treats JPY as zero-decimal", () => {
    expect(parsePriceToInt("1000", "JPY")).toBe(1000);
    expect(parsePriceToInt("1500", "JPY")).toBe(1500);
  });

  it("treats other zero-decimal currencies as zero-decimal", () => {
    expect(parsePriceToInt("50000", "KRW")).toBe(50000);
    expect(parsePriceToInt("250000", "VND")).toBe(250000);
    expect(parsePriceToInt("75000", "ISK")).toBe(75000);
  });

  it("normalizes lowercase currency codes", () => {
    expect(parsePriceToInt("29.95", "usd")).toBe(2995);
    expect(parsePriceToInt("1000", "jpy")).toBe(1000);
  });

  it("works for EUR, GBP, INR, AUD as 2-decimal", () => {
    expect(parsePriceToInt("12.50", "EUR")).toBe(1250);
    expect(parsePriceToInt("9.99", "GBP")).toBe(999);
    expect(parsePriceToInt("499.00", "INR")).toBe(49900);
    expect(parsePriceToInt("75.25", "AUD")).toBe(7525);
  });

  it("throws on a non-numeric amount", () => {
    expect(() => parsePriceToInt("not-a-number", "USD")).toThrow(
      /non-numeric amount/,
    );
    expect(() => parsePriceToInt("", "USD")).toThrow(/non-numeric amount/);
  });
});

describe("parsePriceToInt 3-decimal currency warn", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPriceWarnStateForTesting();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("rounds a 3-decimal currency to 2-decimal cents", () => {
    // 1.234 KWD has 3 minor units; rounding to cents drops the last
    // digit. We accept the rounding error today (Fork #3 default);
    // proper fils-level conversion is a TODO: in price.server.ts.
    expect(parsePriceToInt("1.234", "KWD")).toBe(123);
    expect(parsePriceToInt("100", "KWD")).toBe(10000);
  });

  it("emits exactly one structured warn on the first 3-decimal encounter", () => {
    parsePriceToInt("1.234", "KWD");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(payload.event).toBe("price_3decimal_encountered");
    expect(payload.currency).toBe("KWD");
    expect(payload.action).toBe("rounded_to_2decimal");
    expect(payload.amount).toBe("1.234");
  });

  it("does not warn on subsequent 3-decimal encounters in the same process", () => {
    parsePriceToInt("1.234", "KWD");
    parsePriceToInt("2.500", "BHD");
    parsePriceToInt("10.000", "JOD");
    parsePriceToInt("5.555", "OMR");
    parsePriceToInt("3.333", "TND");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("re-warns after resetPriceWarnStateForTesting()", () => {
    parsePriceToInt("1.234", "KWD");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    resetPriceWarnStateForTesting();
    parsePriceToInt("2.500", "BHD");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("does not warn on 2-decimal or 0-decimal currencies", () => {
    parsePriceToInt("29.95", "USD");
    parsePriceToInt("1000", "JPY");
    parsePriceToInt("12.50", "EUR");
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
