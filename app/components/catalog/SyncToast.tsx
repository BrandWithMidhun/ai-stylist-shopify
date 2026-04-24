// Non-blocking toast shown when a sync is running in DASHBOARD mode.
//
// Sits top-right of the page (fixed position) so the rest of the dashboard
// stays interactive. Three visual states: running, succeeded, failed.
// Polaris <s-banner> gives us the visual; we add scoped CSS for position.

type Props = {
  status: "queued" | "running" | "succeeded" | "failed" | null;
  progress: number;
  total: number;
  durationSeconds: number | null;
  errorMessage: string | null;
  onDismiss: () => void;
  onRetry: () => void;
};

export function SyncToast({
  status,
  progress,
  total,
  durationSeconds,
  errorMessage,
  onDismiss,
  onRetry,
}: Props) {
  if (status === null) return null;

  const countLabel = total > 0 ? `${progress} / ${total}` : "…";

  return (
    <>
      <style>{`
        .sync-toast {
          position: fixed;
          top: 16px;
          right: 16px;
          z-index: 1000;
          max-width: 360px;
          width: calc(100% - 32px);
        }
      `}</style>
      <div className="sync-toast">
        {status === "succeeded" ? (
          <s-banner
            tone="success"
            heading={`Synced ${total} products${
              durationSeconds !== null ? ` · ${durationSeconds}s` : ""
            }`}
            dismissible
            onDismiss={onDismiss}
          >
            <s-paragraph>Your dashboard stats have been refreshed.</s-paragraph>
          </s-banner>
        ) : status === "failed" ? (
          <s-banner tone="critical" heading="Sync failed">
            <s-paragraph>
              {errorMessage ?? "Something went wrong during sync."}
            </s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" onClick={onRetry}>
                Retry
              </s-button>
              <s-button variant="tertiary" onClick={onDismiss}>
                Dismiss
              </s-button>
            </s-stack>
          </s-banner>
        ) : (
          <s-banner
            tone="info"
            heading={`Syncing catalogue · ${countLabel}`}
          >
            <s-paragraph>
              You can keep working — the dashboard will refresh when sync
              finishes.
            </s-paragraph>
          </s-banner>
        )}
      </div>
    </>
  );
}
