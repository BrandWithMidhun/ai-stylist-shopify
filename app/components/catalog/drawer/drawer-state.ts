// Pure helpers for ProductEditDrawer state.
//
// buildInitialState: turns a ProductListItem + per-mode axis-options into
//   the three draft maps (single / multi / text) the drawer renders from.
// buildAxisOrder: produces the render order — storeMode-defined axes
//   first, then any orphan axes the product has from older AI runs (so
//   they survive the replace_all save instead of being silently deleted).

import type { AxisOptions } from "../../../lib/catalog/axis-options";
import type { ProductListItem } from "../../../lib/catalog/loader.server";

export type DrawerInitialState = {
  single: Record<string, string>;
  multi: Record<string, string[]>;
  text: Record<string, string>;
};

export function buildInitialState(
  product: ProductListItem,
  axisOptions: AxisOptions,
): DrawerInitialState {
  const single: Record<string, string> = {};
  const multi: Record<string, string[]> = {};
  const text: Record<string, string> = {};

  // Seed defaults so every standard axis renders even when untagged.
  for (const [axis, def] of Object.entries(axisOptions)) {
    if (def.type === "single") single[axis] = "";
    else if (def.type === "multi") multi[axis] = [];
    else text[axis] = "";
  }

  for (const tag of product.tags) {
    const def = axisOptions[tag.axis];
    if (!def) {
      const prev = text[tag.axis];
      text[tag.axis] = prev ? `${prev}, ${tag.value}` : tag.value;
      continue;
    }
    if (def.type === "single") {
      single[tag.axis] = tag.value;
    } else if (def.type === "multi") {
      const next = new Set(multi[tag.axis] ?? []);
      next.add(tag.value);
      multi[tag.axis] = Array.from(next);
    } else {
      const prev = text[tag.axis];
      text[tag.axis] = prev ? `${prev}, ${tag.value}` : tag.value;
    }
  }

  return { single, multi, text };
}

export function buildAxisOrder(
  product: ProductListItem,
  axisOptions: AxisOptions,
): string[] {
  const ordered: string[] = Object.keys(axisOptions);
  const seen = new Set(ordered);
  for (const tag of product.tags) {
    if (!seen.has(tag.axis)) {
      ordered.push(tag.axis);
      seen.add(tag.axis);
    }
  }
  return ordered;
}
