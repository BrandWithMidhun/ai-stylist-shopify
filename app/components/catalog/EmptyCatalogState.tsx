type Props = {
  isSyncing: boolean;
  progress?: { progress: number; total: number } | null;
  onSync: () => void;
};

export function EmptyCatalogState({ isSyncing, progress, onSync }: Props) {
  const showProgress =
    isSyncing && progress && progress.total > 0
      ? `Syncing · ${progress.progress} / ${progress.total}`
      : isSyncing
        ? "Syncing…"
        : "Sync catalog";

  return (
    <s-section>
      <s-stack direction="block" gap="large" alignItems="center">
        <s-heading>Let&apos;s get your catalogue ready</s-heading>
        <s-paragraph>
          We&apos;ll mirror your Shopify products so the AI stylist can tag,
          group, and recommend them. Nothing runs until you start the sync.
        </s-paragraph>
        <s-button
          variant="primary"
          onClick={onSync}
          {...(isSyncing ? { loading: true, disabled: true } : {})}
        >
          {showProgress}
        </s-button>
        <s-text>
          We&apos;ll subscribe to updates from Shopify after this, so new and
          changed products stay in sync automatically.
        </s-text>
      </s-stack>
    </s-section>
  );
}
