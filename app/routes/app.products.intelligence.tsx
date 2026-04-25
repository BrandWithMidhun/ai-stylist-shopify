import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  loadIntelligenceData,
  type IntelligenceLoaderData,
} from "../lib/catalog/loader.server";
import { useSyncJobProgress } from "../hooks/useSyncJobProgress";
import { EmptyCatalogState } from "../components/catalog/EmptyCatalogState";
import { SyncInProgress } from "../components/catalog/SyncInProgress";
import { Dashboard } from "../components/catalog/Dashboard";

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<IntelligenceLoaderData> => {
  const { session } = await authenticate.admin(request);
  return loadIntelligenceData(session.shop);
};

export default function ProductIntelligencePage() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();

  const syncFetcher = useFetcher<{
    jobId?: string;
    error?: string;
    retryAfterSeconds?: number;
  }>();

  const initialActiveJobId =
    data.mode === "SYNCING_FIRST_TIME"
      ? data.job.jobId
      : data.mode === "DASHBOARD"
        ? (data.activeSyncJob?.jobId ?? null)
        : null;

  const [activeJobId, setActiveJobId] = useState<string | null>(
    initialActiveJobId,
  );
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  const isSyncStarting =
    syncFetcher.state === "submitting" || syncFetcher.state === "loading";

  useEffect(() => {
    if (syncFetcher.data?.jobId) {
      setActiveJobId(syncFetcher.data.jobId);
      setRateLimitMessage(null);
      // Revalidate so the loader re-branches to SYNCING_FIRST_TIME (empty →
      // full-page takeover) or to DASHBOARD-with-activeSyncJob (re-sync toast).
      revalidator.revalidate();
    } else if (syncFetcher.data?.error === "rate_limited") {
      const retry = syncFetcher.data.retryAfterSeconds ?? 0;
      setRateLimitMessage(
        retry > 0
          ? `Sync is rate-limited. Try again in ${retry}s.`
          : "A sync is already running.",
      );
    }
  }, [syncFetcher.data, revalidator]);

  // Keep activeJobId set after terminal status so the hook's snapshot (and
  // thus the success/failure toast or retry screen) stays visible. The job
  // record is purged after ~60s, after which the hook clears the snapshot.
  const { snapshot: jobStatus, etaLabel } = useSyncJobProgress(activeJobId, {
    onSuccess: () => {
      revalidator.revalidate();
    },
  });

  const triggerSync = () => {
    syncFetcher.submit(null, { method: "post", action: "/api/catalog/sync" });
  };

  if (data.mode === "EMPTY") {
    const isSyncing =
      isSyncStarting ||
      (jobStatus !== null &&
        (jobStatus.status === "queued" || jobStatus.status === "running"));
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

  if (data.mode === "SYNCING_FIRST_TIME") {
    return (
      <s-page heading="Product intelligence">
        <SyncInProgress
          job={data.job}
          currentStatus={jobStatus?.status ?? null}
          currentProgress={jobStatus?.progress ?? 0}
          currentTotal={jobStatus?.total ?? 0}
          errorMessage={jobStatus?.error ?? null}
          etaLabel={etaLabel}
          onRetry={triggerSync}
        />
      </s-page>
    );
  }

  return (
    <s-page heading="Product intelligence">
      <Dashboard
        storeMode={data.storeMode}
        stats={data.stats}
        products={data.products}
        productLimit={data.productLimit}
        activeSyncJob={data.activeSyncJob}
        onSync={triggerSync}
        isSyncStarting={isSyncStarting}
        syncJob={
          jobStatus
            ? {
                jobId: jobStatus.jobId,
                status: jobStatus.status,
                progress: jobStatus.progress,
                total: jobStatus.total,
                error: jobStatus.error,
                startedAt: jobStatus.startedAt,
              }
            : null
        }
        rateLimitMessage={rateLimitMessage}
        nodeAxesByNodeId={data.nodeAxesByNodeId}
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
