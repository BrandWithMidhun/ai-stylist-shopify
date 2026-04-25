// Indented tree view for the taxonomy admin page (006a §4.4).
//
// Per Decision 1: up/down position buttons inline (no drag-and-drop in v1).
// 3-dot menu per row: Add child / Rename / Delete. Rename is inline; the
// node editor on the right is the canonical edit surface for everything
// else (keywords, overrides, parent reassignment).

import type { TaxonomyNode } from "@prisma/client";
import { groupByParent } from "../../lib/catalog/taxonomy";

type Props = {
  nodes: readonly TaxonomyNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string | null) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDelete: (node: TaxonomyNode) => void;
};

export function TaxonomyTree({
  nodes,
  selectedId,
  onSelect,
  onAddChild,
  onMoveUp,
  onMoveDown,
  onDelete,
}: Props) {
  const grouped = groupByParent(nodes);
  const roots = grouped.get(null) ?? [];

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <style>{`
        .tax-tree { display: flex; flex-direction: column; gap: 4px; }
        .tax-tree-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; cursor: pointer; }
        .tax-tree-row[data-selected="true"] { background: #e3f1ff; }
        .tax-tree-row:hover { background: #f4f6f8; }
        .tax-tree-row .tax-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tax-tree-row .tax-count { font-size: 11px; color: #6d7175; }
        .tax-tree-row .tax-actions { display: flex; gap: 2px; }
        .tax-tree-row button.tax-icon { background: transparent; border: 1px solid transparent; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 12px; line-height: 1; }
        .tax-tree-row button.tax-icon:hover { border-color: #c4cdd5; background: #fff; }
      `}</style>
      <div className="tax-tree-toolbar">
        <s-button onClick={() => onAddChild(null)}>+ Add root node</s-button>
      </div>
      <div className="tax-tree" role="tree">
        {roots.map((n) => (
          <Subtree
            key={n.id}
            node={n}
            depth={0}
            grouped={grouped}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddChild={onAddChild}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onDelete={onDelete}
          />
        ))}
      </div>
    </s-box>
  );
}

function Subtree({
  node,
  depth,
  grouped,
  selectedId,
  onSelect,
  onAddChild,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  node: TaxonomyNode;
  depth: number;
  grouped: Map<string | null, TaxonomyNode[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string | null) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDelete: (node: TaxonomyNode) => void;
}) {
  const children = grouped.get(node.id) ?? [];
  const indent = depth * 16;
  const selected = selectedId === node.id;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <>
      <div
        className="tax-tree-row"
        data-selected={selected}
        role="treeitem"
        aria-selected={selected}
        tabIndex={0}
        style={{ paddingLeft: 6 + indent }}
        onClick={() => onSelect(node.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(node.id);
          }
        }}
      >
        <span className="tax-name">{node.name}</span>
        {children.length > 0 ? (
          <span className="tax-count">({children.length})</span>
        ) : null}
        <span className="tax-actions">
          <button
            type="button"
            className="tax-icon"
            aria-label="Move up"
            onClick={(e) => {
              stop(e);
              onMoveUp(node.id);
            }}
          >
            ▲
          </button>
          <button
            type="button"
            className="tax-icon"
            aria-label="Move down"
            onClick={(e) => {
              stop(e);
              onMoveDown(node.id);
            }}
          >
            ▼
          </button>
          <button
            type="button"
            className="tax-icon"
            aria-label="Add child"
            onClick={(e) => {
              stop(e);
              onAddChild(node.id);
            }}
          >
            +
          </button>
          <button
            type="button"
            className="tax-icon"
            aria-label="Delete node"
            onClick={(e) => {
              stop(e);
              onDelete(node);
            }}
          >
            ✕
          </button>
        </span>
      </div>
      {children.map((c) => (
        <Subtree
          key={c.id}
          node={c}
          depth={depth + 1}
          grouped={grouped}
          selectedId={selectedId}
          onSelect={onSelect}
          onAddChild={onAddChild}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}
