// Single field renderer used by ProductEditDrawer.
//
// Renders the right control based on the axis definition:
//   - single: <s-select> dropdown
//   - multi:  row of toggleable chip buttons (filled = selected)
//   - text:   <s-text-field>
//
// "Orphan" axes — present on the product but absent from the storeMode's
// axis-options — are passed in with a synthetic text definition so they
// survive the replace_all drawer save instead of being silently deleted.

import type { AxisDefinition } from "../../../lib/catalog/axis-options";

type SingleProps = {
  axis: string;
  label: string;
  def: Extract<AxisDefinition, { type: "single" }>;
  value: string;
  onChange: (next: string) => void;
};

type MultiProps = {
  axis: string;
  label: string;
  def: Extract<AxisDefinition, { type: "multi" }>;
  values: readonly string[];
  onChange: (next: string[]) => void;
};

type TextProps = {
  axis: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
};

export function AxisFieldSingle({ axis, label, def, value, onChange }: SingleProps) {
  return (
    <s-select
      label={label}
      name={axis}
      value={value}
      onChange={(event: Event) => {
        const target = event.currentTarget as HTMLSelectElement;
        onChange(target.value);
      }}
    >
      <s-option value="">— none —</s-option>
      {def.values.map((opt) => (
        <s-option key={opt} value={opt}>
          {opt}
        </s-option>
      ))}
    </s-select>
  );
}

export function AxisFieldMulti({ axis, label, def, values, onChange }: MultiProps) {
  const set = new Set(values);
  const toggle = (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };
  return (
    <div className={`afm afm-${axis}`}>
      <style>{`
        .afm-${axis} { display: flex; flex-direction: column; gap: 6px; }
        .afm-${axis} .afm-label { font-size: 13px; font-weight: 500; color: #202223; }
        .afm-${axis} .afm-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .afm-${axis} .afm-chip { padding: 4px 10px; border-radius: 999px; border: 1px solid #c9cccf; background: #fff; color: #202223; font: inherit; cursor: pointer; font-size: 12px; }
        .afm-${axis} .afm-chip[data-on="true"] { background: #202223; color: #fff; border-color: #202223; }
      `}</style>
      <span className="afm-label">{label}</span>
      <div className="afm-row" role="group" aria-label={label}>
        {def.values.map((opt) => {
          const on = set.has(opt);
          return (
            <button
              key={opt}
              type="button"
              className="afm-chip"
              data-on={on}
              aria-pressed={on}
              onClick={() => toggle(opt)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AxisFieldText({ axis, label, value, onChange }: TextProps) {
  return (
    <s-text-field
      label={label}
      name={axis}
      value={value}
      onInput={(event: Event) => {
        const target = event.currentTarget as HTMLInputElement;
        onChange(target.value);
      }}
    />
  );
}

export function humanizeAxis(axis: string): string {
  return axis
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
