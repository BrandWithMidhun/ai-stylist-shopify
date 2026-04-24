// Small pure helpers used by the intelligence dashboard.
// Extracted from Dashboard.tsx to keep that file focused on composition.

import type { ActiveSyncJob, ProductListItem } from "./loader.server";
import type {
  StatusCounts,
  StockCounts,
} from "../../components/catalog/FilterSidebar";

type SyncJobShape = {
  progress: number;
  total: number;
} | null;

type BatchJobShape = {
  progress: number;
  total: number;
  failed: number;
} | null;

export function buildSyncLabel(
  syncJob: SyncJobShape,
  activeSyncJob: ActiveSyncJob | null,
): string {
  const progress = syncJob?.progress ?? activeSyncJob?.progress ?? 0;
  const total = syncJob?.total ?? activeSyncJob?.total ?? 0;
  return total > 0 ? `Syncing · ${progress} / ${total}` : "Syncing…";
}

export function buildBatchLabel(status: BatchJobShape): string {
  if (!status || status.total === 0) return "Tagging…";
  const base = `Tagging · ${status.progress} / ${status.total}`;
  return status.failed > 0 ? `${base} (${status.failed} failed)` : base;
}

// The loader caps product fetch at 500 (see PRODUCT_LIMIT in loader.server.ts).
// Expose that to the message without re-importing the server constant.
export function productLimitIndicator(count: number): number {
  return count >= 500 ? 500 : count;
}

export function deriveStatusCounts(products: ProductListItem[]): StatusCounts {
  const out: StatusCounts = {
    all: products.length,
    pending: 0,
    any_tagged: 0,
    ai_tagged: 0,
    rule_tagged: 0,
    human_reviewed: 0,
  };
  for (const p of products) {
    if (p.tagStatus === "pending") out.pending += 1;
    else out.any_tagged += 1;
    if (p.tagStatus === "ai_tagged") out.ai_tagged += 1;
    if (p.tagStatus === "rule_tagged") out.rule_tagged += 1;
    if (p.tagStatus === "human_reviewed") out.human_reviewed += 1;
  }
  return out;
}

export function deriveStockCounts(products: ProductListItem[]): StockCounts {
  const out: StockCounts = {
    all: products.length,
    live: 0,
    out_of_stock: 0,
    draft: 0,
    archived: 0,
  };
  for (const p of products) {
    if (
      p.status === "ACTIVE" &&
      (p.inventoryStatus === "IN_STOCK" || p.inventoryStatus === "LOW_STOCK")
    ) {
      out.live += 1;
    }
    if (p.inventoryStatus === "OUT_OF_STOCK") out.out_of_stock += 1;
    if (p.status === "DRAFT") out.draft += 1;
    if (p.status === "ARCHIVED") out.archived += 1;
  }
  return out;
}
