// Two-row workflow bar on the intelligence dashboard.
//
// Row 1 (MAIN WORKFLOW): Tag with AI, view toggle, Rules, Settings.
// Row 2 (REFINE):        Apply Rules, Train System, Sync Stock, Reset tags.
//
// Most REFINE actions are disabled placeholders for Feature 006. The Tag
// with AI and Sync Stock buttons are wired. Reset tags dropdown UI is
// completed here; the API wiring lives in step 11.

import { Link } from "react-router";
import { formatRelativeTime } from "../../lib/catalog/relative-time";

export type ResetScope = "ai_only" | "all_except_human" | "everything";

type Props = {
  pendingTagCount: number;
  rulesCount: number;
  lastFullSyncAt: string | null;
  isSyncing: boolean;
  syncLabel: string;
  onSync: () => void;
  isBatching: boolean;
  batchLabel: string;
  onBatchTag: () => void;
  onRequestReset: (scope: ResetScope) => void;
  resetDisabled: boolean;
};

export function WorkflowBar({
  pendingTagCount,
  rulesCount,
  lastFullSyncAt,
  isSyncing,
  syncLabel,
  onSync,
  isBatching,
  batchLabel,
  onBatchTag,
  onRequestReset,
  resetDisabled,
}: Props) {
  const allTagged = pendingTagCount === 0;
  const tagButtonLabel = isBatching
    ? batchLabel
    : allTagged
      ? "All products tagged"
      : `Tag with AI (${pendingTagCount} pending)`;

  return (
    <s-section>
      <style>{`
        .wf-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .wf-row-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; min-width: 120px; }
        .wf-spacer { flex: 1; }
      `}</style>

      <div className="wf-row">
        <div className="wf-row-label">
          <s-text color="subdued">Main workflow</s-text>
        </div>
        <s-button
          variant="primary"
          onClick={onBatchTag}
          {...(isBatching || allTagged ? { loading: isBatching, disabled: true } : {})}
        >
          <span aria-hidden>🧠 </span>
          {tagButtonLabel}
        </s-button>
        <s-button disabled>Grid</s-button>
        <s-button disabled>
          <s-icon type="info" interest-for="wf-grouped-tip" /> Grouped
        </s-button>
        <s-tooltip id="wf-grouped-tip">Coming in Feature 006</s-tooltip>
        <s-button disabled>Rules ({rulesCount})</s-button>
        <Link to="/app/config">
          <s-button>Settings</s-button>
        </Link>
      </div>

      <div className="wf-row" style={{ marginTop: "8px" }}>
        <div className="wf-row-label">
          <s-text color="subdued">Refine</s-text>
        </div>
        <s-button disabled>
          <s-icon type="info" interest-for="wf-apply-tip" /> Apply rules
        </s-button>
        <s-tooltip id="wf-apply-tip">Coming in Feature 006</s-tooltip>
        <s-button disabled>
          <s-icon type="info" interest-for="wf-train-tip" /> Train system
        </s-button>
        <s-tooltip id="wf-train-tip">Coming in Feature 006</s-tooltip>
        <s-button
          onClick={onSync}
          {...(isSyncing ? { loading: true, disabled: true } : {})}
        >
          {isSyncing
            ? syncLabel
            : `Sync stock · Last synced ${formatRelativeTime(lastFullSyncAt)}`}
        </s-button>
        <div className="wf-spacer" />
        <ResetTagsDropdown
          onRequestReset={onRequestReset}
          disabled={resetDisabled}
        />
      </div>
    </s-section>
  );
}

function ResetTagsDropdown({
  onRequestReset,
  disabled,
}: {
  onRequestReset: (scope: ResetScope) => void;
  disabled: boolean;
}) {
  return (
    <>
      <s-button
        command-for="reset-tags-menu"
        {...(disabled ? { disabled: true } : {})}
      >
        Reset tags ▾
      </s-button>
      <s-menu id="reset-tags-menu" accessibility-label="Reset tags">
        <s-button
          variant="tertiary"
          onClick={() => onRequestReset("ai_only")}
        >
          Reset AI tags
        </s-button>
        <s-button
          variant="tertiary"
          onClick={() => onRequestReset("all_except_human")}
        >
          Reset all tags (keep human)
        </s-button>
        <s-button
          variant="tertiary"
          onClick={() => onRequestReset("everything")}
        >
          Reset everything
        </s-button>
      </s-menu>
    </>
  );
}
