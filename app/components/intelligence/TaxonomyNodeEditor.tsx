// Right-pane editor for the taxonomy admin page (006a §4.4).
//
// Edits name, parent, matchKeywords (chip input), and axisOverrides
// (axis name + type + comma-separated values). Slug is read-only and
// reflects the post-rename stability rule (changes only when parent
// reassigns).

import { useEffect, useMemo, useState } from "react";
import type { TaxonomyNode } from "@prisma/client";
import { parseAxisOverrides, type TaxonomyAxisOverride } from "../../lib/catalog/taxonomy";

type Props = {
  node: TaxonomyNode;
  allNodes: readonly TaxonomyNode[];
  saving: boolean;
  onSave: (input: {
    name: string;
    matchKeywords: string[];
    axisOverrides: TaxonomyAxisOverride[];
    parentId: string | null;
  }) => void;
};

type LocalOverride = {
  axis: string;
  type: "single" | "multi" | "text";
  values: string;
};

export function TaxonomyNodeEditor({ node, allNodes, saving, onSave }: Props) {
  const initial = useMemo(() => deriveInitial(node), [node]);
  const [name, setName] = useState(initial.name);
  const [keywordsRaw, setKeywordsRaw] = useState(initial.keywords);
  const [parentId, setParentId] = useState<string | null>(initial.parentId);
  const [overrides, setOverrides] = useState<LocalOverride[]>(initial.overrides);

  useEffect(() => {
    setName(initial.name);
    setKeywordsRaw(initial.keywords);
    setParentId(initial.parentId);
    setOverrides(initial.overrides);
  }, [initial]);

  const parentOptions = useMemo(
    () => buildParentOptions(node, allNodes),
    [node, allNodes],
  );

  const handleSave = () => {
    const matchKeywords = keywordsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const axisOverrides: TaxonomyAxisOverride[] = overrides
      .filter((o) => o.axis.trim().length > 0)
      .map((o) => {
        const entry: TaxonomyAxisOverride = { axis: o.axis.trim(), type: o.type };
        if (o.type !== "text") {
          entry.values = o.values
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        return entry;
      });
    onSave({ name: name.trim(), matchKeywords, axisOverrides, parentId });
  };

  const addOverride = () =>
    setOverrides((prev) => [...prev, { axis: "", type: "text", values: "" }]);
  const removeOverride = (idx: number) =>
    setOverrides((prev) => prev.filter((_, i) => i !== idx));
  const updateOverride = (idx: number, patch: Partial<LocalOverride>) =>
    setOverrides((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    );

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <style>{`
        .node-editor { display: flex; flex-direction: column; gap: 12px; }
        .node-editor .row { display: flex; flex-direction: column; gap: 4px; }
        .node-editor .ovr-row { display: grid; grid-template-columns: 1fr 100px 1fr auto; gap: 6px; align-items: end; }
        .node-editor .slug { font-family: ui-monospace, monospace; font-size: 12px; color: #6d7175; }
      `}</style>
      <div className="node-editor">
        <div className="row">
          <s-text type="strong">Name</s-text>
          <s-text-field
            value={name}
            label="Node name"
            label-accessibility-visibility="exclusive"
            onInput={(e: Event) => setName((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
        <div className="row">
          <s-text type="strong">Slug</s-text>
          <span className="slug">{node.slug}</span>
        </div>
        <div className="row">
          <s-text type="strong">Parent</s-text>
          <s-select
            value={parentId ?? "__root__"}
            label="Parent"
            label-accessibility-visibility="exclusive"
            onChange={(e: Event) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              setParentId(v === "__root__" ? null : v);
            }}
          >
            <s-option value="__root__">— Root level —</s-option>
            {parentOptions.map((opt) => (
              <s-option key={opt.id} value={opt.id}>
                {opt.label}
              </s-option>
            ))}
          </s-select>
        </div>
        <div className="row">
          <s-text type="strong">Match keywords</s-text>
          <s-text-field
            value={keywordsRaw}
            label="Match keywords"
            label-accessibility-visibility="exclusive"
            placeholder="kurta, kurti"
            onInput={(e: Event) =>
              setKeywordsRaw((e.currentTarget as HTMLInputElement).value)
            }
          />
          <s-text color="subdued">
            Comma-separated. Used by the matcher to assign products to this node.
          </s-text>
        </div>
        <div className="row">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-text type="strong">Axis overrides</s-text>
            <s-button onClick={addOverride}>+ Add override</s-button>
          </s-stack>
          {overrides.length === 0 ? (
            <s-text color="subdued">No overrides — node inherits storeMode-level axes.</s-text>
          ) : null}
          {overrides.map((o, idx) => (
            <div key={idx} className="ovr-row">
              <s-text-field
                value={o.axis}
                label="Axis"
                label-accessibility-visibility="exclusive"
                placeholder="axis_name"
                onInput={(e: Event) =>
                  updateOverride(idx, {
                    axis: (e.currentTarget as HTMLInputElement).value,
                  })
                }
              />
              <s-select
                value={o.type}
                label="Type"
                label-accessibility-visibility="exclusive"
                onChange={(e: Event) => {
                  const v = (e.currentTarget as HTMLSelectElement).value as LocalOverride["type"];
                  updateOverride(idx, { type: v });
                }}
              >
                <s-option value="single">single</s-option>
                <s-option value="multi">multi</s-option>
                <s-option value="text">text</s-option>
              </s-select>
              <s-text-field
                value={o.values}
                label="Values"
                label-accessibility-visibility="exclusive"
                placeholder={o.type === "text" ? "(text — no values)" : "value, value"}
                {...(o.type === "text" ? { disabled: true } : {})}
                onInput={(e: Event) =>
                  updateOverride(idx, {
                    values: (e.currentTarget as HTMLInputElement).value,
                  })
                }
              />
              <s-button onClick={() => removeOverride(idx)}>Remove</s-button>
            </div>
          ))}
        </div>
        <s-stack direction="inline" gap="base">
          <s-button
            variant="primary"
            onClick={handleSave}
            {...(saving ? { loading: true } : {})}
          >
            Save changes
          </s-button>
        </s-stack>
      </div>
    </s-box>
  );
}

function deriveInitial(node: TaxonomyNode): {
  name: string;
  keywords: string;
  parentId: string | null;
  overrides: LocalOverride[];
} {
  const overrides = parseAxisOverrides(node.axisOverrides).map<LocalOverride>(
    (o) => ({
      axis: o.axis,
      type: o.type ?? "text",
      values: (o.values ?? []).join(", "),
    }),
  );
  return {
    name: node.name,
    keywords: node.matchKeywords.join(", "),
    parentId: node.parentId,
    overrides,
  };
}

// All nodes except this node and its descendants (would create a cycle).
function buildParentOptions(
  node: TaxonomyNode,
  allNodes: readonly TaxonomyNode[],
): Array<{ id: string; label: string }> {
  const blocked = new Set<string>([node.id]);
  // BFS expand: any child of a blocked node is blocked.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const before = blocked.size;
    for (const n of allNodes) {
      if (n.parentId && blocked.has(n.parentId)) blocked.add(n.id);
    }
    if (blocked.size === before) break;
  }
  return allNodes
    .filter((n) => !blocked.has(n.id))
    .map((n) => ({ id: n.id, label: labelFor(n, allNodes) }));
}

function labelFor(node: TaxonomyNode, all: readonly TaxonomyNode[]): string {
  const byId = new Map(all.map((n) => [n.id, n] as const));
  const parts: string[] = [];
  let current: TaxonomyNode | undefined = node;
  for (let i = 0; current && i < 16; i += 1) {
    parts.unshift(current.name);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  return parts.join(" / ");
}
