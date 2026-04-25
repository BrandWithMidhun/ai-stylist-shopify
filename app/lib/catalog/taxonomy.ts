// Pure helpers for the taxonomy tree (006a §4).
//
// - slugFromPath: deterministic slug derived from parent path + name.
//   Stable across rename (slug recomputed only on parent reassignment per
//   006a Decision 6).
// - getEffectiveAxes: walks node → root, merges axisOverrides into the
//   storeMode-level axis baseline. Children win on conflict; overrides are
//   additive (a child can override the type/values of an inherited axis but
//   cannot remove it).
//
// Both helpers are pure and synchronous — pass in already-loaded nodes.

import type { TaxonomyNode } from "@prisma/client";
import { axisOptionsFor, type AxisDefinition, type AxisOptions } from "./axis-options";
import type { StoreMode } from "./store-axes";

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugFromPath(parentSlug: string, name: string): string {
  const leaf = slugify(name);
  return parentSlug ? `${parentSlug}-${leaf}` : leaf;
}

export type TaxonomyAxisOverride = {
  axis: string;
  type?: AxisDefinition["type"];
  values?: readonly string[];
  order?: number;
};

// Narrow the JSON column to the override array shape. Anything that doesn't
// parse becomes an empty array (defensive — a future code path should never
// write malformed data, but the JSON column allows it).
export function parseAxisOverrides(raw: unknown): TaxonomyAxisOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: TaxonomyAxisOverride[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.axis !== "string" || obj.axis.length === 0) continue;
    const entry: TaxonomyAxisOverride = { axis: obj.axis };
    if (obj.type === "single" || obj.type === "multi" || obj.type === "text") {
      entry.type = obj.type;
    }
    if (Array.isArray(obj.values)) {
      entry.values = obj.values.filter((v): v is string => typeof v === "string");
    }
    if (typeof obj.order === "number") entry.order = obj.order;
    out.push(entry);
  }
  return out;
}

// Build the chain root → ... → node for a given nodeId.
function ancestorChain(
  nodeId: string,
  byId: Map<string, TaxonomyNode>,
): TaxonomyNode[] {
  const chain: TaxonomyNode[] = [];
  let current: TaxonomyNode | undefined = byId.get(nodeId);
  // Defensive: stop at a hard depth cap so a corrupt parent cycle can't
  // loop forever. Trees are capped at 4 levels in the seed; 16 is generous.
  for (let i = 0; current && i < 16; i += 1) {
    chain.push(current);
    if (!current.parentId) break;
    current = byId.get(current.parentId);
  }
  chain.reverse();
  return chain;
}

export function getEffectiveAxes(
  nodeId: string | null,
  allNodes: readonly TaxonomyNode[],
  storeMode: StoreMode | null | undefined,
): AxisOptions {
  const baseline = axisOptionsFor(storeMode);
  if (!nodeId) return baseline;

  const byId = new Map(allNodes.map((n) => [n.id, n] as const));
  const chain = ancestorChain(nodeId, byId);
  if (chain.length === 0) return baseline;

  const merged: Record<string, AxisDefinition> = { ...baseline };
  for (const node of chain) {
    const overrides = parseAxisOverrides(node.axisOverrides);
    for (const o of overrides) {
      const inheritedType = merged[o.axis]?.type;
      const type = o.type ?? inheritedType ?? "text";
      if (type === "text") {
        merged[o.axis] = { type: "text" };
      } else {
        const values = o.values ??
          (merged[o.axis] && merged[o.axis].type !== "text"
            ? (merged[o.axis] as { values: readonly string[] }).values
            : []);
        merged[o.axis] = { type, values };
      }
    }
  }
  return merged;
}

// Group nodes by parentId for tree rendering. Children are sorted by
// position (asc), then name as a stable tie-break.
export function groupByParent(
  nodes: readonly TaxonomyNode[],
): Map<string | null, TaxonomyNode[]> {
  const map = new Map<string | null, TaxonomyNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const list = map.get(key) ?? [];
    list.push(n);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }
  return map;
}
