// PR-3.1-mech.4: query-extraction tests.
//
// Direct imports — extractQueryAttributes is a pure function with no
// DB or LLM dependencies, so no vi.mock is needed.
//
// Four tests covering 12-fixture-derived patterns (per spec D1):
//   1. "show me daily wear shirts" — synonym-driven (daily→casual,
//      shirts→shirt). The v0.2 misfire fixture; lifting it from FAIL
//      to PASS is the entire point of Stage 3.
//   2. "festive kurta for women" — direct + synonym (women→female).
//      All three FASHION hard-filter axes (gender, category) plus
//      occasion.
//   3. "linen shirts in white" — direct AXIS_OPTIONS match on linen
//      (material axis, NOT a fabric axis — surface point: AXIS_OPTIONS
//      .FASHION has `material`, not `fabric`).
//   4. Profile override — profile.fitPreference="oversized", intent=
//      "casual shirts" — assert fit overwritten from profile, occasion
//      and category extracted from intent.

import { describe, expect, it } from "vitest";
import { extractQueryAttributes } from "./query-extraction.server";
import type { CustomerProfileSnapshot } from "../types";

describe("extractQueryAttributes (FASHION)", () => {
  it("'show me daily wear shirts' extracts category=shirt and occasion=casual", () => {
    const qa = extractQueryAttributes("show me daily wear shirts", "FASHION");
    expect(qa.category).toEqual(["shirt"]);
    expect(qa.occasion).toEqual(["casual"]);
  });

  it("'festive kurta for women' extracts gender=female, category=kurta, occasion=festive", () => {
    const qa = extractQueryAttributes("festive kurta for women", "FASHION");
    expect(qa.gender).toEqual(["female"]);
    expect(qa.category).toEqual(["kurta"]);
    expect(qa.occasion).toEqual(["festive"]);
  });

  it("'linen shirts in white' extracts category=shirt, color_family=white, material=linen", () => {
    // AXIS_OPTIONS.FASHION uses `material`, not `fabric` — surfaced
    // pre-execution and the fixture JSON already aligns to material.
    const qa = extractQueryAttributes("linen shirts in white", "FASHION");
    expect(qa.category).toEqual(["shirt"]);
    expect(qa.color_family).toEqual(["white"]);
    expect(qa.material).toEqual(["linen"]);
  });

  it("profile.fitPreference overrides query-extracted fit; other axes still extract from intent", () => {
    const profile: CustomerProfileSnapshot = {
      fitPreference: "oversized",
    };
    const qa = extractQueryAttributes("casual shirts", "FASHION", profile);
    expect(qa.fit).toEqual(["oversized"]);
    expect(qa.occasion).toEqual(["casual"]);
    expect(qa.category).toEqual(["shirt"]);
  });
});
