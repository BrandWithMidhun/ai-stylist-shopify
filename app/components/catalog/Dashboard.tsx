// Dashboard view for the intelligence page.
//
// Step 3 lands this as a minimal composition that keeps the existing 005b
// batch-tag flow working. Subsequent steps (4-12) replace the placeholder
// blocks with StatsRow, IntelligenceGuide, WorkflowBar, FilterSidebar,
// ProductCard, and SyncToast.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import type {
  ActiveSyncJob,
  ProductListItem,
} from "../../lib/catalog/loader.server";
import type { DashboardStats } from "../../lib/catalog/stats.server";
import { applyFilters } from "../../lib/catalog/filter";
import type { StoreMode } from "../../lib/catalog/store-axes";
import {
  buildBatchLabel,
  buildSyncLabel,
  productLimitIndicator,
} from "../../lib/catalog/dashboard-helpers";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useProductExclude } from "../../hooks/useProductExclude";
import {
  EMPTY_FILTERS,
  FilterSidebar,
  type FilterState,
} from "./FilterSidebar";
import { IntelligenceGuide } from "./IntelligenceGuide";
import { ProductCard } from "./ProductCard";
import { ProductEditDrawer } from "./ProductEditDrawer";
import {
  ResetConfirmBar,
  buildResetError,
} from "./ResetConfirmBar";
import { StatsRow } from "./StatsRow";
import { SyncToast } from "./SyncToast";
import { WorkflowBar, type ResetScope } from "./WorkflowBar";

type SyncJobStatus = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  total: number;
  error: string | null;
  startedAt?: string;
};

type BatchJobStatus = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  total: number;
  failed: number;
  error: string | null;
};

type Props = {
  storeMode: string;
  stats: DashboardStats;
  products: ProductListItem[];
  productLimit: number;
  activeSyncJob: ActiveSyncJob | null;
  onSync: () => void;
  isSyncStarting: boolean;
  syncJob: SyncJobStatus | null;
  rateLimitMessage: string | null;
};

export function Dashboard({
  storeMode,
  stats,
  products,
  activeSyncJob,
  onSync,
  isSyncStarting,
  syncJob,
  rateLimitMessage,
}: Props) {
  const revalidator = useRevalidator();

  const batchFetcher = useFetcher<{
    jobId?: string | null;
    error?: string;
    message?: string;
  }>();
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<BatchJobStatus | null>(null);
  const isBatchStarting =
    batchFetcher.state === "submitting" || batchFetcher.state === "loading";
  const isBatching =
    isBatchStarting ||
    (batchStatus !== null &&
      (batchStatus.status === "queued" || batchStatus.status === "running"));

  useEffect(() => {
    if (batchFetcher.data?.jobId) setBatchJobId(batchFetcher.data.jobId);
  }, [batchFetcher.data]);

  useEffect(() => {
    if (!batchJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/catalog/sync/${batchJobId}`);
        if (!res.ok) {
          if (!cancelled) setBatchJobId(null);
          return;
        }
        const body = (await res.json()) as BatchJobStatus;
        if (cancelled) return;
        setBatchStatus(body);
        if (body.status === "succeeded" || body.status === "failed") {
          setBatchJobId(null);
          revalidator.revalidate();
        }
      } catch {
        // retry on next tick
      }
    };
    void poll();
    // eslint-disable-next-line no-undef
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      // eslint-disable-next-line no-undef
      clearInterval(interval);
    };
  }, [batchJobId, revalidator]);

  const triggerBatch = () => {
    batchFetcher.submit(
      {},
      {
        method: "post",
        action: "/api/products/tags/generate-batch",
        encType: "application/json",
      },
    );
  };

  const resetFetcher = useFetcher<{
    ok: boolean;
    deletedCount?: number;
    error?: string;
    retryAfterSeconds?: number;
  }>();
  const [resetScope, setResetScope] = useState<ResetScope | null>(null);
  const isResetting =
    resetFetcher.state === "submitting" || resetFetcher.state === "loading";
  const handleRequestReset = (scope: ResetScope) => setResetScope(scope);
  const handleCancelReset = () => setResetScope(null);
  const handleConfirmReset = () => {
    if (!resetScope) return;
    resetFetcher.submit(
      { scope: resetScope },
      {
        method: "post",
        action: "/api/catalog/tags/reset",
        encType: "application/json",
      },
    );
  };
  useEffect(() => {
    if (resetFetcher.data?.ok) {
      setResetScope(null);
      revalidator.revalidate();
    }
  }, [resetFetcher.data, revalidator]);

  const exclude = useProductExclude();
  const handleToggleExclude = async (id: string, next: boolean) => {
    const ok = await exclude.toggle(id, next);
    if (ok) revalidator.revalidate();
  };

  // Per-card single-product Generate / Mark Reviewed and the edit drawer
  // are wired here at the dashboard level so only one drawer mounts and so
  // the loader can be revalidated after each mutation.
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [productActionError, setProductActionError] = useState<string | null>(
    null,
  );

  const editingProduct = useMemo(
    () => products.find((p) => p.id === editingProductId) ?? null,
    [products, editingProductId],
  );

  const markGenerating = useCallback((id: string, on: boolean) => {
    setGeneratingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleEdit = useCallback((id: string) => setEditingProductId(id), []);
  const handleCloseDrawer = useCallback(() => setEditingProductId(null), []);

  const handleGenerate = useCallback(
    async (id: string) => {
      markGenerating(id, true);
      setProductActionError(null);
      try {
        const res = await fetch(`/api/products/${id}/tags/generate`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        revalidator.revalidate();
      } catch (err) {
        setProductActionError(
          err instanceof Error ? err.message : "Could not generate tags.",
        );
      } finally {
        markGenerating(id, false);
      }
    },
    [markGenerating, revalidator],
  );

  const handleMarkReviewed = useCallback(
    async (id: string) => {
      setProductActionError(null);
      try {
        const res = await fetch(`/api/products/${id}/mark-reviewed`, {
          method: "POST",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        revalidator.revalidate();
      } catch (err) {
        setProductActionError(
          err instanceof Error ? err.message : "Could not mark reviewed.",
        );
      }
    },
    [revalidator],
  );

  const handleSaveDrawer = useCallback(
    async (tags: { axis: string; value: string }[]) => {
      if (!editingProductId) return;
      const id = editingProductId;
      // Optimistic close — re-open with stale data is jarring; the
      // revalidate below refreshes the card behind the drawer instead.
      setEditingProductId(null);
      setDrawerSaving(true);
      setProductActionError(null);
      try {
        const res = await fetch(`/api/products/${id}/tags`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "replace_all",
            tags: tags.map((t) => ({ ...t, locked: false })),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        revalidator.revalidate();
      } catch (err) {
        setProductActionError(
          err instanceof Error
            ? `Couldn't save changes — ${err.message}`
            : "Couldn't save changes — try again.",
        );
        setEditingProductId(id);
      } finally {
        setDrawerSaving(false);
      }
    },
    [editingProductId, revalidator],
  );

  // Toast visibility: appears when a sync is active OR just completed, until
  // the merchant dismisses it. Re-arms whenever a new sync starts.
  const [toastDismissed, setToastDismissed] = useState(false);
  useEffect(() => {
    if (
      syncJob?.status === "running" ||
      syncJob?.status === "queued" ||
      activeSyncJob !== null
    ) {
      setToastDismissed(false);
    }
  }, [syncJob?.status, syncJob?.jobId, activeSyncJob]);
  const toastStatus = syncJob?.status ?? (activeSyncJob ? "running" : null);
  const showToast = !toastDismissed && toastStatus !== null;
  const toastDuration =
    syncJob?.status === "succeeded" && syncJob.startedAt
      ? Math.max(
          0,
          Math.round((Date.now() - new Date(syncJob.startedAt).getTime()) / 1000),
        )
      : null;

  const isSyncing =
    isSyncStarting ||
    activeSyncJob !== null ||
    (syncJob !== null &&
      (syncJob.status === "queued" || syncJob.status === "running"));

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchRaw, setSearchRaw] = useState("");
  const searchQuery = useDebouncedValue(searchRaw, 150);

  const filtered = useMemo(
    () => applyFilters(products, filters, searchQuery),
    [products, filters, searchQuery],
  );

  return (
    <>
      {showToast ? (
        <SyncToast
          status={toastStatus}
          progress={syncJob?.progress ?? activeSyncJob?.progress ?? 0}
          total={syncJob?.total ?? activeSyncJob?.total ?? 0}
          durationSeconds={toastDuration}
          errorMessage={syncJob?.error ?? null}
          onDismiss={() => setToastDismissed(true)}
          onRetry={onSync}
        />
      ) : null}
      {rateLimitMessage ? (
        <s-banner tone="warning" heading="Sync not started">
          <s-paragraph>{rateLimitMessage}</s-paragraph>
        </s-banner>
      ) : null}
      {exclude.state.lastError ? (
        <s-banner
          tone="critical"
          heading="Could not update product"
          dismissible
          onDismiss={exclude.clearError}
        >
          <s-paragraph>{exclude.state.lastError}</s-paragraph>
        </s-banner>
      ) : null}
      {productActionError ? (
        <s-banner
          tone="critical"
          heading="Product action failed"
          dismissible
          onDismiss={() => setProductActionError(null)}
        >
          <s-paragraph>{productActionError}</s-paragraph>
        </s-banner>
      ) : null}

      <StatsRow stats={stats} />

      <IntelligenceGuide
        tagCoveragePercent={stats.tagCoveragePercent}
        onAutoTag={triggerBatch}
        autoTagDisabled={isBatching || stats.pendingTag === 0}
      />

      <WorkflowBar
        pendingTagCount={stats.pendingTag}
        rulesCount={stats.activeRules}
        lastFullSyncAt={stats.lastFullSyncAt}
        isSyncing={isSyncing}
        syncLabel={buildSyncLabel(syncJob, activeSyncJob)}
        onSync={onSync}
        isBatching={isBatching}
        batchLabel={buildBatchLabel(batchStatus)}
        onBatchTag={triggerBatch}
        onRequestReset={handleRequestReset}
        resetDisabled={false}
      />

      <s-section>
        <style>{`
          .dash-layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; }
          @media (max-width: 900px) { .dash-layout { grid-template-columns: 1fr; } }
          .dash-list-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
        `}</style>
        <div className="dash-layout">
          <FilterSidebar
            filters={filters}
            onChange={setFilters}
            options={stats.filterOptions}
            statusCounts={stats.tagStatusCounts}
            stockCounts={stats.stockStatusCounts}
            recommendationCounts={stats.recommendationCounts}
          />
          <div>
            <div className="dash-list-header">
              <s-search-field
                label="Search products"
                label-accessibility-visibility="exclusive"
                placeholder="Search products by name…"
                value={searchRaw}
                onInput={(event: Event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  setSearchRaw(target.value);
                }}
              />
              <s-text color="subdued">
                Showing {filtered.length} of {products.length}
                {products.length >= productLimitIndicator(products.length)
                  ? ` (limit ${productLimitIndicator(products.length)} — refine to see more)`
                  : ""}
              </s-text>
            </div>
            {filtered.length === 0 ? (
              <s-paragraph>No products match these filters.</s-paragraph>
            ) : (
              <>
                <style>{`
                  .dash-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
                  @media (max-width: 1100px) { .dash-grid { grid-template-columns: repeat(2, 1fr); } }
                  @media (max-width: 640px) { .dash-grid { grid-template-columns: 1fr; } }
                `}</style>
                <div className="dash-grid">
                  {filtered.map((p) => {
                    const optimistic = exclude.state.optimistic[p.id];
                    const effective =
                      typeof optimistic === "boolean"
                        ? { ...p, recommendationExcluded: optimistic }
                        : p;
                    return (
                      <ProductCard
                        key={p.id}
                        product={effective}
                        storeMode={storeMode as StoreMode}
                        onToggleExclude={handleToggleExclude}
                        excludePending={exclude.state.pending.has(p.id)}
                        onEdit={handleEdit}
                        onGenerate={handleGenerate}
                        onMarkReviewed={handleMarkReviewed}
                        generating={generatingIds.has(p.id)}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </s-section>

      <ResetConfirmBar
        scope={resetScope}
        isResetting={isResetting}
        errorMessage={buildResetError(resetFetcher.data)}
        onCancel={handleCancelReset}
        onConfirm={handleConfirmReset}
      />

      {editingProduct ? (
        <ProductEditDrawer
          product={editingProduct}
          storeMode={storeMode as StoreMode}
          open={true}
          saving={drawerSaving}
          onClose={handleCloseDrawer}
          onSave={handleSaveDrawer}
        />
      ) : null}
    </>
  );
}

