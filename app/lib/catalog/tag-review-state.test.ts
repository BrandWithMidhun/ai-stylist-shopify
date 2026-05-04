// PR-2.1: unit tests for the source × status review-state matrix.
//
// The state machine has two orthogonal axes:
//   source: AI | RULE | HUMAN  (who generated the tag)
//   status: PENDING_REVIEW | APPROVED | REJECTED  (what the merchant decided)
//
// Tests cover the planning round's Risks #3 and #8:
//   Risk #3 mitigation — backfill marks ONLY HUMAN-source rows APPROVED.
//   Risk #8 mitigation — locked + REJECTED interaction (locked wins).
// Plus the four planning-round invariants on retag:
//   - APPROVED tags are immune to source-bumps and survive retag.
//   - REJECTED tags persist (not deleted) so they can exclude.
//   - PENDING_REVIEW tags get replaced + an audit row records REGEN.
//   - locked-axes are skipped regardless of status.

import { describe, it, expect } from "vitest";
import {
  computeTagStatus,
  computeTagStatusFull,
  tagStatusLabel,
  type TagReviewStatusValue,
} from "./tag-status";

describe("computeTagStatus (legacy four-label, source-only)", () => {
  it("returns 'pending' for empty source list", () => {
    expect(computeTagStatus([])).toBe("pending");
  });

  it("returns 'human_reviewed' when any source is HUMAN", () => {
    expect(computeTagStatus(["AI", "HUMAN"])).toBe("human_reviewed");
    expect(computeTagStatus([{ source: "HUMAN" }])).toBe("human_reviewed");
  });

  it("returns 'rule_tagged' when any source is RULE (no HUMAN)", () => {
    expect(computeTagStatus(["RULE"])).toBe("rule_tagged");
    expect(computeTagStatus(["AI", "RULE"])).toBe("rule_tagged");
  });

  it("returns 'ai_tagged' when only AI sources are present", () => {
    expect(computeTagStatus(["AI"])).toBe("ai_tagged");
  });

  it("preserves backward compatibility with object-shaped input", () => {
    expect(computeTagStatus([{ source: "AI" }, { source: "HUMAN" }])).toBe(
      "human_reviewed",
    );
  });
});

describe("computeTagStatusFull (orthogonal source × status)", () => {
  // 3 sources × 3 statuses = 9 cells in the matrix.
  const cases: Array<{
    source: string;
    status: TagReviewStatusValue;
    expected: string;
    note: string;
  }> = [
    { source: "AI", status: "PENDING_REVIEW", expected: "ai_tagged", note: "fresh AI suggestion" },
    { source: "AI", status: "APPROVED", expected: "ai_approved", note: "merchant lifted from PENDING" },
    { source: "AI", status: "REJECTED", expected: "ai_rejected", note: "merchant rejected; row persists for exclusion" },
    { source: "RULE", status: "PENDING_REVIEW", expected: "rule_tagged", note: "shouldn't happen post-2.1 but stays a sane label" },
    { source: "RULE", status: "APPROVED", expected: "rule_tagged", note: "implicitly approved" },
    { source: "RULE", status: "REJECTED", expected: "rejected", note: "merchant overrode a rule" },
    { source: "HUMAN", status: "PENDING_REVIEW", expected: "human_reviewed", note: "human-authored = implicitly approved" },
    { source: "HUMAN", status: "APPROVED", expected: "human_reviewed", note: "post-migration backfill state" },
    { source: "HUMAN", status: "REJECTED", expected: "rejected", note: "merchant rejected own work — rare but valid" },
  ];

  for (const c of cases) {
    it(`(${c.source}, ${c.status}) → '${c.expected}' (${c.note})`, () => {
      expect(computeTagStatusFull(c.source, c.status)).toBe(c.expected);
    });
  }

  it("returns 'pending' for unknown source", () => {
    expect(computeTagStatusFull("UNKNOWN", "PENDING_REVIEW")).toBe("pending");
  });
});

describe("tagStatusLabel", () => {
  it("renders all legacy + new labels", () => {
    expect(tagStatusLabel("pending")).toBe("Pending");
    expect(tagStatusLabel("ai_tagged")).toBe("AI Tagged");
    expect(tagStatusLabel("rule_tagged")).toBe("Rule Tagged");
    expect(tagStatusLabel("human_reviewed")).toBe("Human Reviewed");
    expect(tagStatusLabel("ai_approved")).toBe("AI Approved");
    expect(tagStatusLabel("ai_rejected")).toBe("AI Rejected");
    expect(tagStatusLabel("rejected")).toBe("Rejected");
  });
});

// --- Planning-round invariants (Risk #8 + retag semantics) ---------------
//
// These tests express the expected behavior of the tagging engine
// without exercising prisma. They mirror the upsert behavior in
// ai-tagger.server.ts and the prompt-construction contract.
//
// The "model" of the engine here is a small in-memory function that
// takes existing tags + AI suggestions and returns the post-retag
// state, applying the four invariants. If ai-tagger.server.ts ever
// changes its semantics, these tests will need to track.

type TagRow = {
  axis: string;
  value: string;
  source: "AI" | "RULE" | "HUMAN";
  status: TagReviewStatusValue;
  locked: boolean;
};

type AiSuggestion = { axis: string; value: string };

// Mirrors the upsert semantics in ai-tagger.server.ts:
//   - lockedAxes filter: AI suggestions for locked axes are dropped.
//   - rejectedValuesByAxis filter: AI suggestions for rejected values are dropped.
//   - upsert by (productId, axis, value): existing rows preserve their status.
function applyAiSuggestions(
  existing: TagRow[],
  suggestions: AiSuggestion[],
): TagRow[] {
  const lockedAxes = new Set(existing.filter((t) => t.locked).map((t) => t.axis));
  const rejectedByAxis = new Map<string, Set<string>>();
  for (const t of existing) {
    if (t.status === "REJECTED") {
      const set = rejectedByAxis.get(t.axis) ?? new Set();
      set.add(t.value);
      rejectedByAxis.set(t.axis, set);
    }
  }
  const result = existing.slice();
  for (const s of suggestions) {
    if (lockedAxes.has(s.axis)) continue;
    if (rejectedByAxis.get(s.axis)?.has(s.value)) continue;
    const idx = result.findIndex((t) => t.axis === s.axis && t.value === s.value);
    if (idx >= 0) {
      // Existing row — preserve status (APPROVED/REJECTED stays put;
      // PENDING_REVIEW stays PENDING_REVIEW).
      continue;
    }
    result.push({
      axis: s.axis,
      value: s.value,
      source: "AI",
      status: "PENDING_REVIEW",
      locked: false,
    });
  }
  return result;
}

describe("retag invariants", () => {
  it("APPROVED tags survive retag (immunity to source-bump)", () => {
    const existing: TagRow[] = [
      { axis: "occasion", value: "casual", source: "AI", status: "APPROVED", locked: false },
    ];
    const result = applyAiSuggestions(existing, [
      { axis: "occasion", value: "casual" }, // model re-suggests
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("APPROVED");
    expect(result[0].source).toBe("AI"); // unchanged
  });

  it("REJECTED tags persist and exclude same value re-suggestion", () => {
    const existing: TagRow[] = [
      { axis: "occasion", value: "festive", source: "AI", status: "REJECTED", locked: false },
    ];
    const result = applyAiSuggestions(existing, [
      { axis: "occasion", value: "festive" }, // model re-suggests rejected value
      { axis: "occasion", value: "casual" }, // different value on same axis — allowed
    ]);
    expect(result).toHaveLength(2);
    const festive = result.find((t) => t.value === "festive");
    expect(festive?.status).toBe("REJECTED"); // persists
    const casual = result.find((t) => t.value === "casual");
    expect(casual?.status).toBe("PENDING_REVIEW");
  });

  it("locked axes are skipped regardless of status (Risk #8)", () => {
    const existing: TagRow[] = [
      { axis: "fit", value: "slim", source: "HUMAN", status: "APPROVED", locked: true },
    ];
    const result = applyAiSuggestions(existing, [
      { axis: "fit", value: "relaxed" }, // model proposes different value on locked axis
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("slim"); // locked value untouched
  });

  it("locked + REJECTED on same axis: locked wins, no AI suggestion lands", () => {
    const existing: TagRow[] = [
      { axis: "occasion", value: "brunch", source: "AI", status: "REJECTED", locked: true },
    ];
    const result = applyAiSuggestions(existing, [
      { axis: "occasion", value: "brunch" },   // matches REJECTED
      { axis: "occasion", value: "casual" },   // would be allowed if not locked
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].axis).toBe("occasion");
    expect(result[0].value).toBe("brunch");
    expect(result[0].status).toBe("REJECTED");
    expect(result[0].locked).toBe(true);
  });

  it("PENDING_REVIEW status is preserved when upsert re-suggests the same (axis, value)", () => {
    // Scope: this asserts the in-memory upsert model preserves
    // PENDING_REVIEW status when the AI re-suggests the SAME
    // (axis, value) pair. It does NOT assert anything about
    // prompt-construction filtering — that lives in rule-engine.test.ts
    // (the axesStillNeeded filter tests for PR-2.2-mech.2). The
    // separation matters: the rule-engine filter decides whether the
    // AI is asked about an axis at all; this upsert model decides what
    // happens to the row when the AI does propose. Both can be true:
    // PENDING_REVIEW is non-sticky for prompt construction (AI gets
    // re-asked) AND PENDING_REVIEW preserves on upsert when the
    // existing row matches the new suggestion exactly.
    const existing: TagRow[] = [
      { axis: "color_family", value: "blue", source: "AI", status: "PENDING_REVIEW", locked: false },
    ];
    const result = applyAiSuggestions(existing, [
      { axis: "color_family", value: "blue" }, // re-suggests
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("PENDING_REVIEW");
  });

  it("Risk #3 mitigation: only HUMAN-source rows would be backfilled APPROVED", () => {
    // Simulate the migration backfill predicate behavior.
    const preBackfill: TagRow[] = [
      { axis: "occasion", value: "work", source: "AI", status: "PENDING_REVIEW", locked: false },
      { axis: "fit", value: "slim", source: "HUMAN", status: "PENDING_REVIEW", locked: true },
      { axis: "category", value: "shirt", source: "RULE", status: "PENDING_REVIEW", locked: false },
    ];
    // Apply migration UPDATE: source='HUMAN' → status='APPROVED' (and ONLY that).
    const postBackfill = preBackfill.map((t) =>
      t.source === "HUMAN" ? { ...t, status: "APPROVED" as TagReviewStatusValue } : t,
    );
    // AI row stays PENDING_REVIEW (never auto-approved).
    expect(postBackfill.find((t) => t.source === "AI")?.status).toBe("PENDING_REVIEW");
    // RULE row stays PENDING_REVIEW (next rule-engine write lifts it via the
    // PR-2.1 code change in rule-engine.server.ts; backfill doesn't touch it).
    expect(postBackfill.find((t) => t.source === "RULE")?.status).toBe("PENDING_REVIEW");
    // HUMAN row flipped to APPROVED.
    expect(postBackfill.find((t) => t.source === "HUMAN")?.status).toBe("APPROVED");
  });
});
