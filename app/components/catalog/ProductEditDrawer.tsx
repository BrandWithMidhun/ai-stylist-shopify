// Side drawer for editing all tag axes of a single product.
//
// Rendered once at the dashboard level — only one drawer open at a time.
// Per 005d clarifications:
//   - ESC closes (cheap and expected).
//   - Backdrop-click closes regardless of dirty state. No confirm dialog
//     for v1; we accept the cost of accidental data loss until merchants
//     report it as a real problem.
//   - Save flushes the full draft via PUT /api/products/:id/tags with
//     mode=replace_all (server wraps delete+upsert in one $transaction).

import { useEffect, useMemo, useState } from "react";
import { axisOptionsFor } from "../../lib/catalog/axis-options";
import type { ProductListItem } from "../../lib/catalog/loader.server";
import type { StoreMode } from "../../lib/catalog/store-axes";
import {
  AxisFieldMulti,
  AxisFieldSingle,
  AxisFieldText,
  humanizeAxis,
} from "./drawer/AxisField";
import { DrawerFooter } from "./drawer/DrawerFooter";
import { DrawerHeader } from "./drawer/DrawerHeader";
import {
  buildAxisOrder,
  buildInitialState,
} from "./drawer/drawer-state";

type DraftTag = { axis: string; value: string };

type Props = {
  product: ProductListItem;
  storeMode: StoreMode;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (tags: DraftTag[]) => void;
};

export function ProductEditDrawer({
  product,
  storeMode,
  open,
  saving,
  onClose,
  onSave,
}: Props) {
  const axisOptions = axisOptionsFor(storeMode);
  const initial = useMemo(() => buildInitialState(product, axisOptions), [
    product,
    axisOptions,
  ]);
  const [singleVals, setSingleVals] = useState(initial.single);
  const [multiVals, setMultiVals] = useState(initial.multi);
  const [textVals, setTextVals] = useState(initial.text);

  // Re-sync drawer state whenever the underlying product changes (drawer
  // re-opens for a different card, or the loader revalidates after save).
  useEffect(() => {
    setSingleVals(initial.single);
    setMultiVals(initial.multi);
    setTextVals(initial.text);
  }, [initial]);

  // ESC-to-close. 5-line useEffect, no downside (clarification F).
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // eslint-disable-next-line no-undef
    document.addEventListener("keydown", handler);
    // eslint-disable-next-line no-undef
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleReset = () => {
    setSingleVals(initial.single);
    setMultiVals(initial.multi);
    setTextVals(initial.text);
  };

  const handleSave = () => {
    const flat: DraftTag[] = [];
    for (const [axis, value] of Object.entries(singleVals)) {
      if (value) flat.push({ axis, value });
    }
    for (const [axis, values] of Object.entries(multiVals)) {
      for (const v of values) flat.push({ axis, value: v });
    }
    for (const [axis, value] of Object.entries(textVals)) {
      const trimmed = value.trim();
      if (trimmed) flat.push({ axis, value: trimmed });
    }
    onSave(flat);
  };

  const orderedAxes = buildAxisOrder(product, axisOptions);

  return (
    <div className="ped-root" data-open={open} aria-hidden={!open}>
      <style>{`
        .ped-root { position: fixed; inset: 0; pointer-events: none; z-index: 30; }
        .ped-root[data-open="true"] { pointer-events: auto; }
        .ped-root .ped-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.32); opacity: 0; transition: opacity 200ms ease; border: none; cursor: pointer; padding: 0; }
        .ped-root[data-open="true"] .ped-backdrop { opacity: 1; }
        .ped-root .ped-panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(480px, 100vw); background: #fff; box-shadow: -8px 0 24px rgba(0,0,0,0.12); transform: translateX(100%); transition: transform 200ms ease; display: flex; flex-direction: column; }
        .ped-root[data-open="true"] .ped-panel { transform: translateX(0); }
        .ped-root .ped-header { padding: 16px; border-bottom: 1px solid #e1e3e5; display: flex; gap: 12px; align-items: flex-start; }
        .ped-root .ped-thumb { width: 56px; height: 56px; border-radius: 6px; background: #f4f4f4; flex: none; object-fit: cover; }
        .ped-root .ped-title-wrap { flex: 1; min-width: 0; }
        .ped-root .ped-title { font-weight: 600; font-size: 14px; line-height: 1.3; }
        .ped-root .ped-close { background: transparent; border: none; font-size: 22px; cursor: pointer; line-height: 1; padding: 4px; }
        .ped-root .ped-body { padding: 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px; }
        .ped-root .ped-footer { padding: 12px 16px; border-top: 1px solid #e1e3e5; display: flex; gap: 8px; justify-content: flex-end; }
      `}</style>
      <button
        type="button"
        className="ped-backdrop"
        aria-label="Close drawer"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        className="ped-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit tags for ${product.title}`}
      >
        <DrawerHeader product={product} onClose={onClose} />
        <div className="ped-body">
          {orderedAxes.map((axis) => {
            const def = axisOptions[axis];
            const label = humanizeAxis(axis);
            if (!def) {
              return (
                <AxisFieldText
                  key={axis}
                  axis={axis}
                  label={label}
                  value={textVals[axis] ?? ""}
                  onChange={(next) =>
                    setTextVals((prev) => ({ ...prev, [axis]: next }))
                  }
                />
              );
            }
            if (def.type === "single") {
              return (
                <AxisFieldSingle
                  key={axis}
                  axis={axis}
                  label={label}
                  def={def}
                  value={singleVals[axis] ?? ""}
                  onChange={(next) =>
                    setSingleVals((prev) => ({ ...prev, [axis]: next }))
                  }
                />
              );
            }
            if (def.type === "multi") {
              return (
                <AxisFieldMulti
                  key={axis}
                  axis={axis}
                  label={label}
                  def={def}
                  values={multiVals[axis] ?? []}
                  onChange={(next) =>
                    setMultiVals((prev) => ({ ...prev, [axis]: next }))
                  }
                />
              );
            }
            return (
              <AxisFieldText
                key={axis}
                axis={axis}
                label={label}
                value={textVals[axis] ?? ""}
                onChange={(next) =>
                  setTextVals((prev) => ({ ...prev, [axis]: next }))
                }
              />
            );
          })}
        </div>
        <DrawerFooter
          saving={saving}
          onReset={handleReset}
          onCancel={onClose}
          onSave={handleSave}
        />
      </aside>
    </div>
  );
}
