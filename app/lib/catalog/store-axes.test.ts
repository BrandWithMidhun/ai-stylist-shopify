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
