// One row in the rules table (006a §5.6).
//
// Shows summarized condition + effect text for at-a-glance scanning. The
// full structure is editable via the modal RuleEditor; this row is purely
// display + quick toggle/edit/test/delete actions.

import type { TaggingRule } from "@prisma/client";
import type { Condition, Effect } from "../../lib/catalog/rule-types";

type Props = {
  rule: TaggingRule;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (rule: TaggingRule) => void;
  onDelete: (rule: TaggingRule) => void;
};

export function RuleRow({ rule, onToggle, onEdit, onDelete }: Props) {
  const conditions = rule.conditions as unknown as Condition;
  const effects = rule.effects as unknown as Effect[];
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <style>{`
        .rule-row { display: grid; grid-template-columns: 1fr 1fr 80px auto; gap: 12px; align-items: center; }
        @media (max-width: 900px) { .rule-row { grid-template-columns: 1fr; } }
        .rule-summary { font-size: 12px; color: #6d7175; }
        .rule-name { font-weight: 600; }
      `}</style>
      <div className="rule-row">
        <div>
          <div className="rule-name">{rule.name}</div>
          <div className="rule-summary">
            {summarizeConditions(conditions)} → {summarizeEffects(effects)}
          </div>
        </div>
        <div>
          <s-text color="subdued">priority {rule.priority}</s-text>
        </div>
        <div>
          <s-checkbox
            checked={rule.enabled}
            label="Enabled"
            onChange={(e: Event) =>
              onToggle(rule.id, (e.currentTarget as HTMLInputElement).checked)
            }
          />
        </div>
        <s-stack direction="inline" gap="small-200">
          <s-button onClick={() => onEdit(rule)}>Edit</s-button>
          <s-button onClick={() => onDelete(rule)}>Delete</s-button>
        </s-stack>
      </div>
    </s-box>
  );
}

export function summarizeConditions(c: Condition): string {
  switch (c.kind) {
    case "tag_contains":
      return `tag contains "${c.value}"`;
    case "title_contains":
      return `title contains "${c.value}"`;
    case "type_equals":
      return `type = ${c.value}`;
    case "vendor_equals":
      return `vendor = ${c.value}`;
    case "price_range": {
      const lo = c.min !== undefined ? `≥${c.min}` : "";
      const hi = c.max !== undefined ? `≤${c.max}` : "";
      return `price ${lo}${lo && hi ? " " : ""}${hi}`.trim() || "price (any)";
    }
    case "all":
      return c.conditions.map(summarizeConditions).join(" AND ");
    case "any":
      return c.conditions.map(summarizeConditions).join(" OR ");
    case "not":
      return `NOT (${summarizeConditions(c.condition)})`;
    default:
      return "(unknown)";
  }
}

export function summarizeEffects(effects: Effect[]): string {
  return effects
    .map((e) => {
      const v = Array.isArray(e.value) ? e.value.join(",") : e.value;
      return `${e.axis}=${v}`;
    })
    .join(", ");
}
