// PR-2.2-mech.3: regression tests for the reporter's classifyTagPair
// helper. The bug this commit fixes: pre-mech.3, scripts/report-
// backfill.mjs had hand-mirrored copies of STARTER_AXES + AXIS_OPTIONS.
// FASHION which silently went stale at mech.1 when sustainability and
// season axes were added to the TS source-of-truth without a matching
// .mjs update.
//
// The fix: convert the reporter to .ts and import vocabulary from the
// canonical source (app/lib/catalog/store-axes + axis-options). These
// tests pin the new behavior and catch any future regression where
// the import path drifts or new axes added to FASHION fail to reach
// the classifier.

import { describe, it, expect } from "vitest";
import { classifyTagPair } from "./report-backfill";

describe("classifyTagPair (PR-2.2-mech.3 regression)", () => {
  describe("FASHION mode — PR-2.2-mech.1 vocabulary additions", () => {
    it("sustainability=eco_friendly classifies as in-vocab", () => {
      const r = classifyTagPair("sustainability", "eco_friendly", "FASHION");
      expect(r.kind).toBe("in-vocab");
    });

    it("sustainability=biodegradable classifies as in-vocab", () => {
      const r = classifyTagPair("sustainability", "biodegradable", "FASHION");
      expect(r.kind).toBe("in-vocab");
    });

    it("sustainability=conventional classifies as in-vocab (the deliberate fallback)", () => {
      const r = classifyTagPair("sustainability", "conventional", "FASHION");
      expect(r.kind).toBe("in-vocab");
    });

    it("season=all_season classifies as in-vocab", () => {
      const r = classifyTagPair("season", "all_season", "FASHION");
      expect(r.kind).toBe("in-vocab");
    });

    it("season=monsoon classifies as in-vocab (India-relevant addition)", () => {
      const r = classifyTagPair("season", "monsoon", "FASHION");
      expect(r.kind).toBe("in-vocab");
    });

    it("season=summer classifies as in-vocab", () => {
      const r = classifyTagPair("season", "summer", "FASHION");
      expect(r.kind).toBe("in-vocab");
    });
  });

  describe("FASHION mode — PR-2.2-mech.4 vocabulary additions (n=50 evidence)", () => {
    it("sleeve_length=full_sleeve classifies as in-vocab", () => {
      expect(classifyTagPair("sleeve_length", "full_sleeve", "FASHION").kind).toBe("in-vocab");
    });

    it("sleeve_length=half_sleeve classifies as in-vocab", () => {
      expect(classifyTagPair("sleeve_length", "half_sleeve", "FASHION").kind).toBe("in-vocab");
    });

    it("pattern=solid classifies as in-vocab", () => {
      expect(classifyTagPair("pattern", "solid", "FASHION").kind).toBe("in-vocab");
    });

    it("pattern=pinstripe classifies as in-vocab", () => {
      expect(classifyTagPair("pattern", "pinstripe", "FASHION").kind).toBe("in-vocab");
    });

    it("collar_type=regular_collar classifies as in-vocab", () => {
      expect(classifyTagPair("collar_type", "regular_collar", "FASHION").kind).toBe("in-vocab");
    });

    it("collar_type=spread_collar classifies as in-vocab", () => {
      expect(classifyTagPair("collar_type", "spread_collar", "FASHION").kind).toBe("in-vocab");
    });

    it("collar_style classifies as axis-not-in-vocab (deliberate omission — schema canonicalizes on collar_type)", () => {
      // The AI inconsistently used `collar_style` for the same concept
      // as `collar_type` in the n=50 evidence (14% hit rate). PR-2.2-
      // mech.4 deliberately did NOT add `collar_style` to the schema
      // — only `collar_type`. This test pins that deliberate omission
      // so a future "fix" doesn't accidentally add the duplicate axis.
      expect(classifyTagPair("collar_style", "regular_collar", "FASHION").kind).toBe("axis-not-in-vocab");
    });
  });

  describe("FASHION mode — pre-existing core axes still work (no regression)", () => {
    it("gender=male classifies as in-vocab", () => {
      expect(classifyTagPair("gender", "male", "FASHION").kind).toBe("in-vocab");
    });

    it("category=shirt classifies as in-vocab", () => {
      expect(classifyTagPair("category", "shirt", "FASHION").kind).toBe("in-vocab");
    });

    it("color_family=navy classifies as in-vocab", () => {
      expect(classifyTagPair("color_family", "navy", "FASHION").kind).toBe("in-vocab");
    });

    it("price_tier=luxury classifies as in-vocab", () => {
      expect(classifyTagPair("price_tier", "luxury", "FASHION").kind).toBe("in-vocab");
    });
  });

  describe("FASHION mode — out-of-vocab cases", () => {
    it("axis=delivery_mode classifies as axis-not-in-vocab (PR-2.1 smoke gap)", () => {
      const r = classifyTagPair("delivery_mode", "online", "FASHION");
      expect(r.kind).toBe("axis-not-in-vocab");
    });

    it("color_family=neon classifies as out-of-vocab (axis valid, value invented)", () => {
      const r = classifyTagPair("color_family", "neon", "FASHION");
      expect(r.kind).toBe("out-of-vocab");
    });

    it("season=year_round classifies as out-of-vocab (close-but-wrong)", () => {
      const r = classifyTagPair("season", "year_round", "FASHION");
      expect(r.kind).toBe("out-of-vocab");
    });

    it("sustainability=green classifies as out-of-vocab (close-but-wrong)", () => {
      const r = classifyTagPair("sustainability", "green", "FASHION");
      expect(r.kind).toBe("out-of-vocab");
    });
  });

  describe("FASHION mode — free-form axes accept any value", () => {
    it("sub_category=anything classifies as free-form-allowed (sub_category is type=text)", () => {
      const r = classifyTagPair("sub_category", "linen", "FASHION");
      expect(r.kind).toBe("free-form-allowed");
    });

    it("sub_category=arbitrary string classifies as free-form-allowed", () => {
      const r = classifyTagPair("sub_category", "polished_satin_blend_v2", "FASHION");
      expect(r.kind).toBe("free-form-allowed");
    });
  });

  describe("Other modes", () => {
    it("ELECTRONICS category=phone classifies as in-vocab", () => {
      expect(classifyTagPair("category", "phone", "ELECTRONICS").kind).toBe("in-vocab");
    });

    it("FURNITURE room=living_room classifies as in-vocab", () => {
      expect(classifyTagPair("room", "living_room", "FURNITURE").kind).toBe("in-vocab");
    });

    it("BEAUTY skin_type=oily classifies as in-vocab", () => {
      expect(classifyTagPair("skin_type", "oily", "BEAUTY").kind).toBe("in-vocab");
    });

    it("JEWELLERY metal=gold classifies as in-vocab", () => {
      expect(classifyTagPair("metal", "gold", "JEWELLERY").kind).toBe("in-vocab");
    });

    it("GENERAL category=anything classifies as free-form-allowed (GENERAL is mostly free-form)", () => {
      // GENERAL.category is type=text per axis-options.ts.
      expect(classifyTagPair("category", "miscellaneous_widget", "GENERAL").kind).toBe("free-form-allowed");
    });

    it("axis-not-in-vocab signals consistently across modes", () => {
      // material is in FASHION but not in ELECTRONICS.
      expect(classifyTagPair("material", "cotton", "FASHION").kind).toBe("in-vocab");
      expect(classifyTagPair("material", "cotton", "ELECTRONICS").kind).toBe("axis-not-in-vocab");
    });
  });

  describe("Result shape", () => {
    it("preserves the input axis and value in the discriminated result", () => {
      const r = classifyTagPair("gender", "male", "FASHION");
      expect(r.axis).toBe("gender");
      expect(r.value).toBe("male");
    });

    it("axis-not-in-vocab preserves the offending axis name", () => {
      const r = classifyTagPair("delivery_mode", "online", "FASHION");
      expect(r.axis).toBe("delivery_mode");
      expect(r.value).toBe("online");
    });
  });
});
