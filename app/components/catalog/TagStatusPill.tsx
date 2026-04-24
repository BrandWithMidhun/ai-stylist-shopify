import type { TagStatus } from "../../lib/catalog/tag-status";
import { tagStatusLabel } from "../../lib/catalog/tag-status";

type Tone = "info" | "success" | "caution" | undefined;

const TONE: Record<TagStatus, Tone> = {
  pending: undefined,
  ai_tagged: "info",
  rule_tagged: "caution",
  human_reviewed: "success",
};

export function TagStatusPill({ status }: { status: TagStatus }) {
  const tone = TONE[status];
  const label = tagStatusLabel(status);
  const props = tone ? { tone } : {};
  return <s-badge {...props}>{label}</s-badge>;
}
