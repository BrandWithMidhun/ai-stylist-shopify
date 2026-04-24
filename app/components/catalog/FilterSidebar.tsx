// Left-hand filter sidebar for the intelligence dashboard.
//
// v1: client-side filtering via applyFilters() in app/lib/catalog/filter.ts.
// Values for Gender / Product type / Colour come from
// DashboardStats.filterOptions. Status / Stock / Recommendations are static
// enums with counts.

export type StatusFilter =
  | "all"
  | "pending"
  | "any_tagged"
  | "ai_tagged"
  | "rule_tagged"
  | "human_reviewed";

export type StockFilter =
  | "all"
  | "live"
  | "out_of_stock"
  | "draft"
  | "archived";

export type RecommendationFilter = "all" | "included" | "excluded";

export type FilterState = {
  gender: string; // "" = all
  productType: string;
  colourFamily: string;
  status: StatusFilter;
  statement: string;
  stock: StockFilter;
  recommendation: RecommendationFilter;
};

export const EMPTY_FILTERS: FilterState = {
  gender: "",
  productType: "",
  colourFamily: "",
  status: "all",
  statement: "",
  stock: "all",
  recommendation: "all",
};

export type FilterOptionSet = {
  genders: string[];
  productTypes: string[];
  colourFamilies: string[];
};

export type StatusCounts = {
  all: number;
  pending: number;
  any_tagged: number;
  ai_tagged: number;
  rule_tagged: number;
  human_reviewed: number;
};

export type StockCounts = {
  all: number;
  live: number;
  out_of_stock: number;
  draft: number;
  archived: number;
};

type Props = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  options: FilterOptionSet;
  statusCounts: StatusCounts;
  stockCounts: StockCounts;
};

const STATUS_CHOICES: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "any_tagged", label: "Any tagged" },
  { value: "ai_tagged", label: "AI tagged" },
  { value: "rule_tagged", label: "Rule tagged" },
  { value: "human_reviewed", label: "Human reviewed" },
];

const STOCK_CHOICES: Array<{ value: StockFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "out_of_stock", label: "Out of stock" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

const RECOMMENDATION_CHOICES: Array<{
  value: RecommendationFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "included", label: "Included" },
  { value: "excluded", label: "Excluded" },
];

export function FilterSidebar({
  filters,
  onChange,
  options,
  statusCounts,
  stockCounts,
}: Props) {
  const update = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => onChange({ ...filters, [key]: value });

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <style>{`
        .filter-group { margin-bottom: 16px; }
        .filter-group-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
      `}</style>
      <s-heading>Filters</s-heading>

      <div className="filter-group">
        <SelectFilter
          label="Gender"
          value={filters.gender}
          options={options.genders}
          onChange={(v) => update("gender", v)}
        />
      </div>

      <div className="filter-group">
        <SelectFilter
          label="Product type"
          value={filters.productType}
          options={options.productTypes}
          onChange={(v) => update("productType", v)}
        />
      </div>

      <div className="filter-group">
        <SelectFilter
          label="Colour family"
          value={filters.colourFamily}
          options={options.colourFamilies}
          onChange={(v) => update("colourFamily", v)}
        />
      </div>

      <div className="filter-group">
        <div className="filter-group-label">
          <s-text color="subdued">Tag status</s-text>
        </div>
        {STATUS_CHOICES.map((c) => (
          <RadioRow
            key={c.value}
            name="status-filter"
            selected={filters.status === c.value}
            label={c.label}
            count={statusCounts[c.value]}
            onSelect={() => update("status", c.value)}
          />
        ))}
      </div>

      <div className="filter-group">
        <div className="filter-group-label">
          <s-text color="subdued">Stock status</s-text>
        </div>
        {STOCK_CHOICES.map((c) => (
          <RadioRow
            key={c.value}
            name="stock-filter"
            selected={filters.stock === c.value}
            label={c.label}
            count={stockCounts[c.value]}
            onSelect={() => update("stock", c.value)}
          />
        ))}
      </div>

      <div className="filter-group">
        <div className="filter-group-label">
          <s-text color="subdued">Recommendations</s-text>
        </div>
        {RECOMMENDATION_CHOICES.map((c) => (
          <RadioRow
            key={c.value}
            name="rec-filter"
            selected={filters.recommendation === c.value}
            label={c.label}
            onSelect={() => update("recommendation", c.value)}
          />
        ))}
      </div>
    </s-box>
  );
}

function SelectFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  return (
    <s-select
      label={label}
      value={value}
      onChange={(event: Event) => {
        const target = event.currentTarget as HTMLSelectElement;
        onChange(target.value);
      }}
    >
      <s-option value="">All</s-option>
      {options.map((opt) => (
        <s-option key={opt} value={opt}>
          {opt}
        </s-option>
      ))}
    </s-select>
  );
}

function RadioRow({
  name,
  selected,
  label,
  count,
  onSelect,
}: {
  name: string;
  selected: boolean;
  label: string;
  count?: number;
  onSelect: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 0",
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        onChange={onSelect}
      />
      <s-text>{label}</s-text>
      {typeof count === "number" ? (
        <s-text color="subdued">({count})</s-text>
      ) : null}
    </label>
  );
}

