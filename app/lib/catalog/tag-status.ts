export type TagSource = "AI" | "RULE" | "HUMAN";

export type TagStatus =
  | "pending"
  | "ai_tagged"
  | "rule_tagged"
  | "human_reviewed";

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

export function tagStatusLabel(status: TagStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "ai_tagged":
      return "AI Tagged";
    case "rule_tagged":
      return "Rule Tagged";
    case "human_reviewed":
      return "Human Reviewed";
  }
}
