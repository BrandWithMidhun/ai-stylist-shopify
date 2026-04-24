import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  computeTagStatus,
  tagStatusLabel,
  type TagStatus,
} from "../lib/catalog/tag-status";
import { EmptyCatalogState } from "../components/catalog/EmptyCatalogState";
import { TagStatusPill } from "../components/catalog/TagStatusPill";

const LIST_LIMIT = 100;

type ProductListItem = {
  id: string;
  title: string;
  handle: string;
  status: string;
  inventoryStatus: string;
  featuredImageUrl: string | null;
  tags: Array<{ axis: string; value: string; source: string; locked: boolean }>;
  tagStatus: TagStatus;
};

type LoaderData =
  | { empty: true }
  | {
      empty: false;
      lastFullSyncAt: string;
      products: ProductListItem[];
    };

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);

  const config = await prisma.merchantConfig.findUnique({
    where: { shop: session.shop },
    select: { lastFullSyncAt: true },
  });

  if (!config?.lastFullSyncAt) {
    return { empty: true };
  }

  const products = await prisma.product.findMany({
    where: { shopDomain: session.shop, deletedAt: null },
    include: { tags: true },
    orderBy: { shopifyUpdatedAt: "desc" },
    take: LIST_LIMIT,
  });

  return {
    empty: false,
    lastFullSyncAt: config.lastFullSyncAt.toISOString(),
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      inventoryStatus: p.inventoryStatus,
      featuredImageUrl: p.featuredImageUrl,
      tags: p.tags.map((t) => ({
        axis: t.axis,
        value: t.value,
        source: t.source,
        locked: t.locked,
      })),
      tagStatus: computeTagStatus(p.tags.map((t) => t.source)),
    })),
  };
};

type FilterValue = "all" | TagStatus;

const FILTER_OPTIONS: Array<{ value: FilterValue; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "ai_tagged", label: "AI Tagged" },
  { value: "human_reviewed", label: "Human Reviewed" },
];

type SyncJobStatus = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  total: number;
  error: string | null;
};

export default function ProductIntelligencePage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const syncFetcher = useFetcher<{
    jobId?: string;
    error?: string;
    retryAfterSeconds?: number;
  }>();
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<SyncJobStatus | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  const isSyncStarting =
    syncFetcher.state === "submitting" || syncFetcher.state === "loading";
  const isSyncing =
    isSyncStarting ||
    (jobStatus !== null &&
      (jobStatus.status === "queued" || jobStatus.status === "running"));

  useEffect(() => {
    if (syncFetcher.data?.jobId) {
      setActiveJobId(syncFetcher.data.jobId);
      setRateLimitMessage(null);
    } else if (syncFetcher.data?.error === "rate_limited") {
      const retry = syncFetcher.data.retryAfterSeconds ?? 0;
      setRateLimitMessage(
        retry > 0
          ? `Sync is rate-limited. Try again in ${retry}s.`
          : "A sync is already running.",
      );
    }
  }, [syncFetcher.data]);

  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/catalog/sync/${activeJobId}`);
        if (!res.ok) {
          if (!cancelled) setActiveJobId(null);
          return;
        }
        const body = (await res.json()) as SyncJobStatus;
        if (cancelled) return;
        setJobStatus(body);
        if (body.status === "succeeded") {
          setActiveJobId(null);
          revalidator.revalidate();
        } else if (body.status === "failed") {
          setActiveJobId(null);
        }
      } catch {
        // ignore transient network errors; next tick will retry
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
  }, [activeJobId, revalidator]);

  const triggerSync = () => {
    syncFetcher.submit(null, { method: "post", action: "/api/catalog/sync" });
  };

  if (data.empty) {
    return (
      <s-page heading="Product intelligence">
        {rateLimitMessage ? (
          <s-banner tone="warning" heading="Sync not started">
            <s-paragraph>{rateLimitMessage}</s-paragraph>
          </s-banner>
        ) : null}
        {jobStatus?.status === "failed" ? (
          <s-banner tone="critical" heading="Sync failed">
            <s-paragraph>{jobStatus.error ?? "Unknown error."}</s-paragraph>
          </s-banner>
        ) : null}
        <EmptyCatalogState
          isSyncing={isSyncing}
          progress={
            jobStatus
              ? { progress: jobStatus.progress, total: jobStatus.total }
              : null
          }
          onSync={triggerSync}
        />
      </s-page>
    );
  }

  return (
    <NonEmptyView
      products={data.products}
      lastFullSyncAt={data.lastFullSyncAt}
      isSyncing={isSyncing}
      jobStatus={jobStatus}
      rateLimitMessage={rateLimitMessage}
      onSync={triggerSync}
    />
  );
}

type BatchJobStatus = {
  jobId: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  total: number;
  failed: number;
  error: string | null;
};

function NonEmptyView({
  products,
  lastFullSyncAt,
  isSyncing,
  jobStatus,
  rateLimitMessage,
  onSync,
}: {
  products: ProductListItem[];
  lastFullSyncAt: string;
  isSyncing: boolean;
  jobStatus: SyncJobStatus | null;
  rateLimitMessage: string | null;
  onSync: () => void;
}) {
  const [filter, setFilter] = useState<FilterValue>("all");
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
    if (batchFetcher.data?.jobId) {
      setBatchJobId(batchFetcher.data.jobId);
    }
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

  const filtered = useMemo(() => {
    if (filter === "all") return products;
    return products.filter((p) => p.tagStatus === filter);
  }, [products, filter]);

  const lastSyncedLabel = useMemo(() => {
    const d = new Date(lastFullSyncAt);
    return d.toLocaleString();
  }, [lastFullSyncAt]);

  const syncButtonLabel = isSyncing
    ? jobStatus && jobStatus.total > 0
      ? `Syncing · ${jobStatus.progress} / ${jobStatus.total}`
      : "Syncing…"
    : `Sync catalog · Last synced ${lastSyncedLabel}`;

  return (
    <s-page heading="Product intelligence">
      {rateLimitMessage ? (
        <s-banner tone="warning" heading="Sync not started">
          <s-paragraph>{rateLimitMessage}</s-paragraph>
        </s-banner>
      ) : null}
      {jobStatus?.status === "failed" ? (
        <s-banner tone="critical" heading="Sync failed">
          <s-paragraph>{jobStatus.error ?? "Unknown error."}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center">
          <s-button
            variant="primary"
            onClick={onSync}
            {...(isSyncing ? { loading: true, disabled: true } : {})}
          >
            {syncButtonLabel}
          </s-button>
          <s-button
            onClick={triggerBatch}
            {...(isBatching ? { loading: true, disabled: true } : {})}
          >
            {isBatching && batchStatus && batchStatus.total > 0
              ? `Tagging · ${batchStatus.progress} / ${batchStatus.total}${
                  batchStatus.failed > 0 ? ` (${batchStatus.failed} failed)` : ""
                }`
              : "Generate tags for all"}
          </s-button>
          <s-select
            label="Filter by status"
            value={filter}
            onChange={(event: Event) => {
              const target = event.currentTarget as HTMLSelectElement;
              setFilter(target.value as FilterValue);
            }}
          >
            {FILTER_OPTIONS.map((opt) => (
              <s-option key={opt.value} value={opt.value}>
                {opt.label}
              </s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      <s-section heading={`Products (${filtered.length})`}>
        {filtered.length === 0 ? (
          <s-paragraph>No products match this filter.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {filtered.map((p) => (
              <ProductRow key={p.id} product={p} />
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

function ProductRow({ product }: { product: ProductListItem }) {
  const revalidator = useRevalidator();
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const isGenerating =
    fetcher.state === "submitting" || fetcher.state === "loading";

  useEffect(() => {
    if (fetcher.data?.ok) {
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  const onGenerate = () => {
    fetcher.submit(null, {
      method: "post",
      action: `/api/products/${product.id}/tags/generate`,
    });
  };

  return (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background="subdued"
    >
      <s-stack direction="inline" gap="base" alignItems="center">
        {product.featuredImageUrl ? (
          <s-image
            src={product.featuredImageUrl}
            alt={product.title}
            aspectRatio="1/1"
          />
        ) : null}
        <s-stack direction="block" gap="small-200">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-text>{product.title}</s-text>
            <TagStatusPill status={product.tagStatus} />
          </s-stack>
          <s-text>
            {product.status} · {product.inventoryStatus}
          </s-text>
          {product.tags.length > 0 ? (
            <s-stack direction="inline" gap="small-200">
              {product.tags.map((t) => (
                <s-badge key={`${t.axis}:${t.value}`}>
                  {t.axis}: {t.value}
                </s-badge>
              ))}
            </s-stack>
          ) : (
            <s-text>
              {tagStatusLabel("pending")} — no tags yet.
            </s-text>
          )}
          {fetcher.data?.ok === false && fetcher.data.error ? (
            <s-text>Tag generation failed: {fetcher.data.error}</s-text>
          ) : null}
          <s-stack direction="inline" gap="small-200">
            <s-button
              onClick={onGenerate}
              {...(isGenerating ? { loading: true, disabled: true } : {})}
            >
              Generate tags
            </s-button>
          </s-stack>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
