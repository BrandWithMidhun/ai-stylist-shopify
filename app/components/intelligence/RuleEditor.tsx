// Modal-style rule editor (006a §5.6).
//
// Per Decision 2: a single-condition builder + a JSON textarea fallback
// for nested any/all/not. The simple builder handles 90% of cases; raw
// JSON is the escape hatch for power users.
//
// Effects: a small list of { axis, value } rows. Multi-value axes accept
// comma-separated values which we serialize as string[].

import { useEffect, useMemo, useState } from "react";
import type { TaxonomyNode } from "@prisma/client";
import {
  ConditionSchema,
  EffectsSchema,
  type Condition,
  type Effect,
} from "../../lib/catalog/rule-types";

export type RuleDraft = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  taxonomyNodeId: string | null;
  conditions: Condition;
  effects: Effect[];
};

type Props = {
  draft: RuleDraft;
  taxonomyNodes: readonly TaxonomyNode[];
  saving: boolean;
  onCancel: () => void;
  onSave: (draft: RuleDraft) => void;
  onTest: (draft: RuleDraft, productId: string) => Promise<TestResult>;
};

export type TestResult = {
  matched: boolean;
  tagsWritten: { axis: string; value: string }[];
  axesStillNeeded: string[];
  error?: string;
};

export function RuleEditor({ draft, taxonomyNodes, saving, onCancel, onSave, onTest }: Props) {
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [enabled, setEnabled] = useState(draft.enabled);
  const [priority, setPriority] = useState(String(draft.priority));
  const [taxonomyNodeId, setTaxonomyNodeId] = useState<string | null>(draft.taxonomyNodeId);

  const [advanced, setAdvanced] = useState(() => isComplex(draft.conditions));
  const [conditionsJson, setConditionsJson] = useState(() =>
    JSON.stringify(draft.conditions, null, 2),
  );
  const [simpleCondition, setSimpleCondition] = useState<SimpleCondition>(() =>
    isComplex(draft.conditions)
      ? { kind: "title_contains", value: "" }
      : (draft.conditions as SimpleCondition),
  );

  const [effects, setEffects] = useState<EffectInput[]>(() =>
    draft.effects.map((e) => ({
      axis: e.axis,
      value: Array.isArray(e.value) ? e.value.join(", ") : e.value,
      multi: Array.isArray(e.value),
    })),
  );

  const [testProductId, setTestProductId] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setName(draft.name);
    setDescription(draft.description);
    setEnabled(draft.enabled);
    setPriority(String(draft.priority));
    setTaxonomyNodeId(draft.taxonomyNodeId);
    setAdvanced(isComplex(draft.conditions));
    setConditionsJson(JSON.stringify(draft.conditions, null, 2));
    if (!isComplex(draft.conditions)) {
      setSimpleCondition(draft.conditions as SimpleCondition);
    }
    setEffects(
      draft.effects.map((e) => ({
        axis: e.axis,
        value: Array.isArray(e.value) ? e.value.join(", ") : e.value,
        multi: Array.isArray(e.value),
      })),
    );
    setTestResult(null);
    setValidationError(null);
  }, [draft]);

  const buildDraft = (): RuleDraft | { error: string } => {
    let conditions: Condition;
    if (advanced) {
      try {
        const parsed = JSON.parse(conditionsJson);
        const r = ConditionSchema.safeParse(parsed);
        if (!r.success) return { error: `conditions: ${r.error.message}` };
        conditions = r.data;
      } catch (err) {
        return { error: `conditions JSON: ${err instanceof Error ? err.message : "invalid"}` };
      }
    } else {
      const r = ConditionSchema.safeParse(simpleCondition);
      if (!r.success) return { error: `conditions: ${r.error.message}` };
      conditions = r.data;
    }

    const effectsOut: Effect[] = effects
      .filter((e) => e.axis.trim().length > 0 && e.value.trim().length > 0)
      .map((e) => {
        if (e.multi) {
          const values = e.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return { axis: e.axis.trim(), value: values };
        }
        return { axis: e.axis.trim(), value: e.value.trim() };
      });
    const er = EffectsSchema.safeParse(effectsOut);
    if (!er.success) return { error: `effects: ${er.error.message}` };

    return {
      id: draft.id,
      name: name.trim(),
      description: description.trim(),
      enabled,
      priority: Number(priority) || 0,
      taxonomyNodeId,
      conditions,
      effects: er.data,
    };
  };

  const handleSave = () => {
    setValidationError(null);
    const built = buildDraft();
    if ("error" in built) {
      setValidationError(built.error);
      return;
    }
    if (!built.name) {
      setValidationError("Name is required.");
      return;
    }
    onSave(built);
  };

  const handleTest = async () => {
    setValidationError(null);
    setTestResult(null);
    if (!testProductId.trim()) {
      setValidationError("Enter a product ID to test.");
      return;
    }
    const built = buildDraft();
    if ("error" in built) {
      setValidationError(built.error);
      return;
    }
    setTesting(true);
    try {
      const r = await onTest(built, testProductId.trim());
      setTestResult(r);
    } finally {
      setTesting(false);
    }
  };

  const addEffect = () =>
    setEffects((prev) => [...prev, { axis: "", value: "", multi: false }]);
  const updateEffect = (idx: number, patch: Partial<EffectInput>) =>
    setEffects((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  const removeEffect = (idx: number) =>
    setEffects((prev) => prev.filter((_, i) => i !== idx));

  const sortedNodes = useMemo(
    () =>
      taxonomyNodes
        .slice()
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    [taxonomyNodes],
  );

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <style>{`
        .rule-editor { display: flex; flex-direction: column; gap: 12px; }
        .rule-editor .row { display: flex; flex-direction: column; gap: 4px; }
        .rule-editor .effect-row { display: grid; grid-template-columns: 1fr 1fr 100px auto; gap: 6px; align-items: end; }
        .rule-editor textarea.cond-json { width: 100%; min-height: 140px; font-family: ui-monospace, monospace; font-size: 12px; padding: 8px; border: 1px solid #c4cdd5; border-radius: 4px; }
      `}</style>
      <div className="rule-editor">
        <s-heading>{draft.id ? "Edit rule" : "Create rule"}</s-heading>
        {validationError ? (
          <s-banner tone="critical">
            <s-paragraph>{validationError}</s-paragraph>
          </s-banner>
        ) : null}

        <div className="row">
          <s-text type="strong">Name</s-text>
          <s-text-field
            value={name}
            label="Rule name"
            label-accessibility-visibility="exclusive"
            onInput={(e: Event) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div className="row">
          <s-text type="strong">Description</s-text>
          <s-text-field
            value={description}
            label="Description"
            label-accessibility-visibility="exclusive"
            onInput={(e: Event) => setDescription((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <s-stack direction="inline" gap="base">
          <s-checkbox
            checked={enabled}
            label="Enabled"
            onChange={(e: Event) =>
              setEnabled((e.currentTarget as HTMLInputElement).checked)
            }
          />
          <s-number-field
            value={priority}
            label="Priority"
            onInput={(e: Event) => setPriority((e.currentTarget as HTMLInputElement).value)}
          />
        </s-stack>
        <div className="row">
          <s-text type="strong">Scope</s-text>
          <s-select
            value={taxonomyNodeId ?? "__any__"}
            label="Scope"
            label-accessibility-visibility="exclusive"
            onChange={(e: Event) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              setTaxonomyNodeId(v === "__any__" ? null : v);
            }}
          >
            <s-option value="__any__">Any node</s-option>
            {sortedNodes.map((n) => (
              <s-option key={n.id} value={n.id}>
                {n.slug}
              </s-option>
            ))}
          </s-select>
        </div>

        <div className="row">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">Conditions</s-text>
            <s-checkbox
              checked={advanced}
              label="Advanced (JSON)"
              onChange={(e: Event) => {
                const next = (e.currentTarget as HTMLInputElement).checked;
                setAdvanced(next);
                if (next) {
                  setConditionsJson(JSON.stringify(simpleCondition, null, 2));
                }
              }}
            />
          </s-stack>
          {advanced ? (
            <textarea
              className="cond-json"
              value={conditionsJson}
              onChange={(e) => setConditionsJson(e.currentTarget.value)}
            />
          ) : (
            <SimpleConditionEditor
              condition={simpleCondition}
              onChange={setSimpleCondition}
            />
          )}
        </div>

        <div className="row">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">Effects</s-text>
            <s-button onClick={addEffect}>+ Add effect</s-button>
          </s-stack>
          {effects.length === 0 ? (
            <s-text color="subdued">Add at least one effect.</s-text>
          ) : null}
          {effects.map((e, i) => (
            <div key={i} className="effect-row">
              <s-text-field
                value={e.axis}
                label="Axis"
                label-accessibility-visibility="exclusive"
                placeholder="axis_name"
                onInput={(ev: Event) =>
                  updateEffect(i, {
                    axis: (ev.currentTarget as HTMLInputElement).value,
                  })
                }
              />
              <s-text-field
                value={e.value}
                label="Value"
                label-accessibility-visibility="exclusive"
                placeholder={e.multi ? "value, value" : "value"}
                onInput={(ev: Event) =>
                  updateEffect(i, {
                    value: (ev.currentTarget as HTMLInputElement).value,
                  })
                }
              />
              <s-checkbox
                checked={e.multi}
                label="Multi"
                onChange={(ev: Event) =>
                  updateEffect(i, {
                    multi: (ev.currentTarget as HTMLInputElement).checked,
                  })
                }
              />
              <s-button onClick={() => removeEffect(i)}>Remove</s-button>
            </div>
          ))}
        </div>

        <div className="row">
          <s-text type="strong">Test against a product</s-text>
          <s-stack direction="inline" gap="small-200">
            <s-text-field
              value={testProductId}
              label="Product ID"
              label-accessibility-visibility="exclusive"
              placeholder="Product cuid"
              onInput={(e: Event) =>
                setTestProductId((e.currentTarget as HTMLInputElement).value)
              }
            />
            <s-button onClick={handleTest} {...(testing ? { loading: true } : {})}>
              Test
            </s-button>
          </s-stack>
          {testResult ? <TestResultPreview result={testResult} /> : null}
        </div>

        <s-stack direction="inline" gap="base">
          <s-button onClick={onCancel}>Cancel</s-button>
          <s-button
            variant="primary"
            onClick={handleSave}
            {...(saving ? { loading: true } : {})}
          >
            Save
          </s-button>
        </s-stack>
      </div>
    </s-box>
  );
}

// ------------------------------------------------------------------ helpers

type EffectInput = { axis: string; value: string; multi: boolean };

type SimpleCondition =
  | { kind: "tag_contains"; value: string; ci?: boolean }
  | { kind: "title_contains"; value: string; ci?: boolean }
  | { kind: "type_equals"; value: string }
  | { kind: "vendor_equals"; value: string }
  | { kind: "price_range"; min?: number; max?: number };

function isComplex(c: Condition): boolean {
  return c.kind === "all" || c.kind === "any" || c.kind === "not";
}

function SimpleConditionEditor({
  condition,
  onChange,
}: {
  condition: SimpleCondition;
  onChange: (next: SimpleCondition) => void;
}) {
  return (
    <s-stack direction="inline" gap="small-200">
      <s-select
        value={condition.kind}
        label="Kind"
        label-accessibility-visibility="exclusive"
        onChange={(e: Event) => {
          const kind = (e.currentTarget as HTMLSelectElement).value as SimpleCondition["kind"];
          if (kind === "price_range") {
            onChange({ kind, min: undefined, max: undefined });
          } else {
            onChange({ kind, value: "" } as SimpleCondition);
          }
        }}
      >
        <s-option value="tag_contains">tag contains</s-option>
        <s-option value="title_contains">title contains</s-option>
        <s-option value="type_equals">type equals</s-option>
        <s-option value="vendor_equals">vendor equals</s-option>
        <s-option value="price_range">price range</s-option>
      </s-select>
      {condition.kind === "price_range" ? (
        <>
          <s-number-field
            value={condition.min === undefined ? "" : String(condition.min)}
            label="Min"
            onInput={(e: Event) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              onChange({ ...condition, min: v === "" ? undefined : Number(v) });
            }}
          />
          <s-number-field
            value={condition.max === undefined ? "" : String(condition.max)}
            label="Max"
            onInput={(e: Event) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              onChange({ ...condition, max: v === "" ? undefined : Number(v) });
            }}
          />
        </>
      ) : (
        <s-text-field
          value={condition.value}
          label="Value"
          label-accessibility-visibility="exclusive"
          placeholder="value"
          onInput={(e: Event) =>
            onChange({ ...condition, value: (e.currentTarget as HTMLInputElement).value })
          }
        />
      )}
    </s-stack>
  );
}

function TestResultPreview({ result }: { result: TestResult }) {
  if (result.error) {
    return (
      <s-banner tone="critical">
        <s-paragraph>{result.error}</s-paragraph>
      </s-banner>
    );
  }
  if (!result.matched) {
    return (
      <s-banner tone="info">
        <s-paragraph>Rule did not match this product.</s-paragraph>
      </s-banner>
    );
  }
  return (
    <s-banner tone="success">
      <s-paragraph>
        Would write:{" "}
        {result.tagsWritten.map((t) => `${t.axis}=${t.value}`).join(", ") || "(nothing)"}
      </s-paragraph>
    </s-banner>
  );
}
