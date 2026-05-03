// PR-2.1: status semantics extended.
//
// Pre-2.1 design: status was DERIVED from source alone, three distinct
// labels (ai_tagged, rule_tagged, human_reviewed) plus the
// no-tags-yet pending state.
//
// Post-2.1 design: source (who generated) and status (what the merchant
// decided) are orthogonal. The DB carries an explicit
// ProductTag.status enum (PENDING_REVIEW / APPROVED / REJECTED).
// The label is the join of the two.
//
// Existing callers (the dashboard) consume the legacy four-label
// shape via computeTagStatus(sources). To stay backward-compatible:
//   - source=HUMAN  → 'human_reviewed' (HUMAN-source is implicitly APPROVED)
//   - source=RULE   → 'rule_tagged'    (RULE-source is implicitly APPROVED)
//   - source=AI     → 'ai_tagged'      (regardless of review status, for
//                                       backward compat with the dashboard)
//   - no sources    → 'pending'
//
// New callers that need the orthogonal view (the 2.3 review queue)
// should call computeTagStatusFull, which returns the (source, status)
// product-space labels: 'ai_approved', 'ai_rejected', 'rule_tagged',
// 'human_reviewed', 'rejected', 'ai_tagged'.

export type TagSource = "AI" | "RULE" | "HUMAN";

export type TagStatus =
  | "pending"
  | "ai_tagged"
  | "rule_tagged"
  | "human_reviewed";

// PR-2.1: extended label set for the orthogonal (source × status)
// view. Adds three new labels alongside the legacy four:
//   ai_approved   — source=AI, status=APPROVED (merchant lifted from PENDING_REVIEW)
//   ai_rejected   — source=AI, status=REJECTED
//   rejected      — fallback when status=REJECTED but source is unknown
export type TagStatusFull =
  | TagStatus
  | "ai_approved"
  | "ai_rejected"
  | "rejected";

export type TagReviewStatusValue = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export function computeTagStatus(
  sources: readonly string[] | readonly { source: string }[],
): TagStatus {
  if (!sources.length) return "pending";
  const flat: string[] = sources.map((s) =>
    typeof s === "string" ? s : s.source,
  );
  if (flat.some((s) => s === "HUMAN")) return "human_reviewed";
  if (flat.some((s) => s === "RULE")) return "rule_tagged";
  if (flat.some((s) => s === "AI")) return "ai_tagged";
  return "pending";
}

// PR-2.1: orthogonal-view label for a single (source, status) pair.
// Used by the 2.3 review UI to render per-row badges that reflect
// both who generated the tag and what the merchant decided.
export function computeTagStatusFull(
  source: string,
  status: TagReviewStatusValue,
): TagStatusFull {
  if (status === "REJECTED") {
    if (source === "AI") return "ai_rejected";
    return "rejected";
  }
  // APPROVED + PENDING_REVIEW share the source-derived label space.
  if (source === "HUMAN") return "human_reviewed";
  if (source === "RULE") return "rule_tagged";
  if (source === "AI") {
    return status === "APPROVED" ? "ai_approved" : "ai_tagged";
  }
  return "pending";
}

export function tagStatusLabel(status: TagStatus | TagStatusFull): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "ai_tagged":
      return "AI Tagged";
    case "rule_tagged":
      return "Rule Tagged";
    case "human_reviewed":
      return "Human Reviewed";
    case "ai_approved":
      return "AI Approved";
    case "ai_rejected":
      return "AI Rejected";
    case "rejected":
      return "Rejected";
  }
}
