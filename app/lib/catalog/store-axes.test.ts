// PR-2.2-mech.1: tests for the FASHION axis vocabulary.
//
// STARTER_AXES is derived from Object.keys(AXIS_OPTIONS), so adding a
// key to AXIS_OPTIONS.FASHION automatically lands it in STARTER_AXES.
// These tests assert presence-of-key-axes (not total count) so future
// additions don't break the suite.
//
// Regression check included: every FASHION axis declared in
// STARTER_AXES has a corresponding entry in AXIS_OPTIONS.FASHION.
// (The reverse is true by construction — STARTER_AXES is the
// derived view.)

import { describe, it, expect } from "vitest";
import { AXIS_OPTIONS } from "./axis-options";
import { STARTER_AXES } from "./store-axes";

describe("FASHION axis vocabulary", () => {
  it("includes the core garment axes", () => {
    const fashion = STARTER_AXES.FASHION;
    expect(fashion).toContain("gender");
    expect(fashion).toContain("category");
    expect(fashion).toContain("sub_category");
    expect(fashion).toContain("fit");
    expect(fashion).toContain("color_family");
    expect(fashion).toContain("occasion");
    expect(fashion).toContain("style_type");
    expect(fashion).toContain("statement_piece");
    expect(fashion).toContain("material");
    expect(fashion).toContain("size_range");
    expect(fashion).toContain("price_tier");
  });

  it("includes the PR-2.2-mech.1 additions (sustainability, season)", () => {
    const fashion = STARTER_AXES.FASHION;
    expect(fashion).toContain("sustainability");
    expect(fashion).toContain("season");
  });

  it("includes the PR-2.2-mech.4 additions (sleeve_length, pattern, collar_type)", () => {
    const fashion = STARTER_AXES.FASHION;
    expect(fashion).toContain("sleeve_length");
    expect(fashion).toContain("pattern");
    expect(fashion).toContain("collar_type");
  });

  it("DELIBERATELY does NOT include collar_style (schema canonicalizes on collar_type)", () => {
    // The AI inconsistently used `collar_style` for the same concept
    // as `collar_type` in the n=50 backfill evidence (14% hit rate).
    // PR-2.2-mech.4 only added `collar_type`. Pin the omission so a
    // future contributor doesn't accidentally add the duplicate.
    const fashion = STARTER_AXES.FASHION;
    expect(fashion).not.toContain("collar_style");
  });

  it("sleeve_length axis declares a single-value enum with both half/short and full/long synonyms", () => {
    const def = AXIS_OPTIONS.FASHION.sleeve_length;
    expect(def.type).toBe("single");
    if (def.type === "single") {
      expect(def.values).toContain("full_sleeve");
      expect(def.values).toContain("half_sleeve");
      // Industry-synonyms also present so the AI can use either:
      expect(def.values).toContain("long_sleeve");
      expect(def.values).toContain("short_sleeve");
      expect(def.values).toContain("sleeveless");
      expect(def.values).toContain("three_quarter_sleeve");
    }
  });

  it("pattern axis declares a single-value enum covering common fabric patterns", () => {
    const def = AXIS_OPTIONS.FASHION.pattern;
    expect(def.type).toBe("single");
    if (def.type === "single") {
      // n=50 observed values:
      expect(def.values).toContain("solid");
      expect(def.values).toContain("pinstripe");
      // Coverage for common merchant-side filters:
      expect(def.values).toContain("striped");
      expect(def.values).toContain("checked");
      expect(def.values).toContain("printed");
      expect(def.values).toContain("colorblock");
    }
  });

  it("collar_type axis declares a single-value enum covering common shirt + jacket collars", () => {
    const def = AXIS_OPTIONS.FASHION.collar_type;
    expect(def.type).toBe("single");
    if (def.type === "single") {
      // n=50 observed values:
      expect(def.values).toContain("regular_collar");
      expect(def.values).toContain("spread_collar");
      // Indian-ethnic context (mandarin/band) and shirt variants:
      expect(def.values).toContain("mandarin_collar");
      expect(def.values).toContain("band_collar");
      expect(def.values).toContain("button_down_collar");
      expect(def.values).toContain("no_collar");
    }
  });

  it("sustainability axis declares a multi-value enum with conventional fallback", () => {
    const def = AXIS_OPTIONS.FASHION.sustainability;
    expect(def.type).toBe("multi");
    if (def.type === "multi") {
      // Starter values from the limited-5 evidence (eco_friendly was
      // observed; conventional is the deliberate non-sustainable
      // fallback to prevent forced-omission).
      expect(def.values).toContain("eco_friendly");
      expect(def.values).toContain("organic");
      expect(def.values).toContain("recycled");
      expect(def.values).toContain("fair_trade");
      expect(def.values).toContain("vegan");
      expect(def.values).toContain("cruelty_free");
      expect(def.values).toContain("biodegradable");
      expect(def.values).toContain("conventional");
    }
  });

  it("season axis declares a multi-value enum including India-relevant monsoon", () => {
    const def = AXIS_OPTIONS.FASHION.season;
    expect(def.type).toBe("multi");
    if (def.type === "multi") {
      // Limited-5 observed all_season + summer; monsoon added for
      // India-relevant context.
      expect(def.values).toContain("summer");
      expect(def.values).toContain("winter");
      expect(def.values).toContain("monsoon");
      expect(def.values).toContain("spring");
      expect(def.values).toContain("autumn");
      expect(def.values).toContain("all_season");
      expect(def.values).toContain("transitional");
    }
  });

  it("every FASHION axis in STARTER_AXES has an entry in AXIS_OPTIONS.FASHION", () => {
    // Regression: adding to STARTER_AXES without adding the value
    // declaration (or vice-versa) leaves the AI prompt's
    // commonValuesByAxis map missing entries. Since STARTER_AXES is
    // derived from Object.keys(AXIS_OPTIONS), this can only fail if
    // someone refactored the derivation — guard against that.
    const declared = new Set(Object.keys(AXIS_OPTIONS.FASHION));
    for (const axis of STARTER_AXES.FASHION) {
      expect(declared.has(axis)).toBe(true);
    }
  });

  it("STARTER_AXES is non-empty for every store mode (regression)", () => {
    // Adding axes to one mode shouldn't accidentally orphan others.
    for (const mode of ["FASHION", "ELECTRONICS", "FURNITURE", "BEAUTY", "JEWELLERY", "GENERAL"] as const) {
      expect(STARTER_AXES[mode].length).toBeGreaterThan(0);
    }
  });
});
