// Pure client-side filter over the loaded product list.
//
// Used by the intelligence dashboard. Server-side filtering (URL params)
// is deferred per spec §6.5 and §12.

import type { TagStatus } from "./tag-status";
import type { FilterState } from "../../components/catalog/FilterSidebar";

type FilterableProduct = {
  title: string;
  status: string;
  inventoryStatus: string;
  productType: string | null;
  recommendationExcluded: boolean;
  tags: Array<{ axis: string; value: string; source: string }>;
  tagStatus: TagStatus;
};

export function applyFilters<T extends FilterableProduct>(
  products: T[],
  filters: FilterState,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();

  return products.filter((p) => {
    if (q && !p.title.toLowerCase().includes(q)) return false;

    if (filters.gender) {
      if (
        !p.tags.some(
          (t) => t.axis === "gender" && t.value === filters.gender,
        )
      ) {
        return false;
      }
    }

    if (filters.productType) {
      if (p.productType !== filters.productType) return false;
    }

    if (filters.colourFamily) {
      if (
        !p.tags.some(
          (t) =>
            (t.axis === "color_family" || t.axis === "color") &&
            t.value === filters.colourFamily,
        )
      ) {
        return false;
      }
    }

    if (filters.status !== "all") {
      if (filters.status === "any_tagged") {
        if (p.tagStatus === "pending") return false;
      } else if (p.tagStatus !== filters.status) {
        return false;
      }
    }

    if (filters.stock !== "all") {
      const matches =
        (filters.stock === "live" &&
          p.status === "ACTIVE" &&
          (p.inventoryStatus === "IN_STOCK" ||
            p.inventoryStatus === "LOW_STOCK")) ||
        (filters.stock === "out_of_stock" &&
          p.inventoryStatus === "OUT_OF_STOCK") ||
        (filters.stock === "draft" && p.status === "DRAFT") ||
        (filters.stock === "archived" && p.status === "ARCHIVED");
      if (!matches) return false;
    }

    if (filters.recommendation === "included" && p.recommendationExcluded)
      return false;
    if (filters.recommendation === "excluded" && !p.recommendationExcluded)
      return false;

    return true;
  });
}
