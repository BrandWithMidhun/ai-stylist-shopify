// Left-hand filter sidebar for the intelligence dashboard.
//
// v1: client-side filtering via applyFilters() in app/lib/catalog/filter.ts.
// Values for Gender / Product type / Colour come from
// DashboardStats.filterOptions. Status / Stock / Recommendations are static
// enums with counts.
//
// Counts are shop-wide (DashboardStats.tagStatusCounts /
// stockStatusCounts / recommendationCounts), not derived from the loaded
// product window, so they line up with the stats cards.

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

// Count types match DashboardStats.tagStatusCounts / stockStatusCounts /
// recommendationCounts in stats.server.ts. Keys are camelCase; the snake_case
// filter values (e.g. "ai_tagged") map to count keys via the *_CHOICES tables
// below.
export type StatusCounts = {
  all: number;
  pending: number;
  anyTagged: number;
  aiTagged: number;
  ruleTagged: number;
  humanReviewed: number;
};

export type StockCounts = {
  all: number;
  live: number;
  outOfStock: number;
  draft: number;
  archived: number;
};

export type RecommendationCounts = {
  all: number;
  included: number;
  excluded: number;
};

type Props = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  options: FilterOptionSet;
  statusCounts: StatusCounts;
  stockCounts: StockCounts;
  recommendationCounts: RecommendationCounts;
};

const STATUS_CHOICES: Array<{
  value: StatusFilter;
  label: string;
  countKey: keyof StatusCounts;
}> = [
  { value: "all", label: "All", countKey: "all" },
  { value: "pending", label: "Pending", countKey: "pending" },
  { value: "any_tagged", label: "Any tagged", countKey: "anyTagged" },
  { value: "ai_tagged", label: "AI tagged", countKey: "aiTagged" },
  { value: "rule_tagged", label: "Rule tagged", countKey: "ruleTagged" },
  {
    value: "human_reviewed",
    label: "Human reviewed",
    countKey: "humanReviewed",
  },
];

const STOCK_CHOICES: Array<{
  value: StockFilter;
  label: string;
  countKey: keyof StockCounts;
}> = [
  { value: "all", label: "All", countKey: "all" },
  { value: "live", label: "Live", countKey: "live" },
  { value: "out_of_stock", label: "Out of stock", countKey: "outOfStock" },
  { value: "draft", label: "Draft", countKey: "draft" },
  { value: "archived", label: "Archived", countKey: "archived" },
];

const RECOMMENDATION_CHOICES: Array<{
  value: RecommendationFilter;
  label: string;
  countKey: keyof RecommendationCounts;
}> = [
  { value: "all", label: "All", countKey: "all" },
  { value: "included", label: "Included", countKey: "included" },
  { value: "excluded", label: "Excluded", countKey: "excluded" },
];

export function FilterSidebar({
  filters,
  onChange,
  options,
  statusCounts,
  stockCounts,
  recommendationCounts,
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
            count={statusCounts[c.countKey]}
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
            count={stockCounts[c.countKey]}
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
            count={recommendationCounts[c.countKey]}
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

