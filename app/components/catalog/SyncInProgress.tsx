// Full-page takeover shown during the merchant's first catalog sync.
//
// Spec §5: centered layout with animated spinner, heading, body copy,
// progress bar, phase text, and ETA. Polaris does not ship a determinate
// percentage progress bar — we fall back to a CSS-fill div per spec §5.3.

import type { ActiveSyncJob } from "../../lib/catalog/loader.server";
import { phaseFor } from "../../lib/catalog/eta";

type Props = {
  job: ActiveSyncJob;
  currentStatus: "queued" | "running" | "succeeded" | "failed" | null;
  currentProgress: number;
  currentTotal: number;
  errorMessage: string | null;
  etaLabel: string;
  onRetry: () => void;
};

export function SyncInProgress({
  job,
  currentProgress,
  currentTotal,
  currentStatus,
  errorMessage,
  etaLabel,
  onRetry,
}: Props) {
  const progress = currentProgress > 0 ? currentProgress : job.progress;
  const total = currentTotal > 0 ? currentTotal : job.total;
  const percent =
    total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
  const phase = phaseFor(progress, total, currentStatus);

  if (currentStatus === "failed") {
    return (
      <s-section>
        <style>{`
          .sync-fail { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 40px 16px; }
        `}</style>
        <div className="sync-fail">
          <s-banner tone="critical" heading="Sync failed">
            <s-paragraph>
              {errorMessage ?? "Something went wrong during sync."}
            </s-paragraph>
          </s-banner>
          <s-button variant="primary" onClick={onRetry}>
            Retry sync
          </s-button>
        </div>
      </s-section>
    );
  }

  return (
    <s-section>
      <style>{`
        .sync-wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 40px 16px; text-align: center; max-width: 560px; margin: 0 auto; }
        .sync-bar-track { width: 100%; max-width: 440px; height: 10px; background: #e1e3e5; border-radius: 6px; overflow: hidden; }
        .sync-bar-fill { height: 100%; background: #008060; transition: width 400ms ease; }
        .sync-meta { display: flex; flex-direction: column; gap: 4px; align-items: center; }
      `}</style>
      <div className="sync-wrap">
        <s-spinner size="large" accessibility-label="Syncing catalog" />
        <s-heading>Syncing your Shopify catalogue</s-heading>
        <s-paragraph>
          We&apos;re mirroring your products so the AI stylist can tag, group,
          and recommend them. You can close this tab — sync will continue in
          the background.
        </s-paragraph>
        <div
          className="sync-bar-track"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Sync progress ${percent}%`}
        >
          <div className="sync-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="sync-meta">
          <s-text type="strong">
            {total > 0
              ? `${progress} / ${total} (${percent}%)`
              : "Counting your catalogue…"}
          </s-text>
          <s-text color="subdued">Phase: {phase}</s-text>
          {total > 0 ? (
            <s-text color="subdued">
              Estimated time remaining: {etaLabel}
            </s-text>
          ) : null}
        </div>
      </div>
    </s-section>
  );
}
