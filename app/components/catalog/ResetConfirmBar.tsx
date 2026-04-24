// Inline confirmation bar for destructive Reset-tags actions.
//
// Decision #4: prefer <s-modal>, fall back to an inline confirm bar.
// We use the inline bar because <s-modal> requires App Bridge integration
// that isn't yet wired into this route. Fixed-positioned at bottom-center,
// z-index above everything else.

import type { ResetScope } from "./WorkflowBar";

export type ResetResponseData = {
  ok?: boolean;
  error?: string;
  retryAfterSeconds?: number;
};

type Props = {
  scope: ResetScope | null;
  isResetting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

const RESET_COPY: Record<
  ResetScope,
  { heading: string; body: string; confirmLabel: string }
> = {
  ai_only: {
    heading: "Reset AI tags?",
    body: "This removes every tag that was added by AI. Rules and human-reviewed tags stay. The action cannot be undone but you can re-run AI tagging afterwards.",
    confirmLabel: "Reset AI tags",
  },
  all_except_human: {
    heading: "Reset all tags except human-reviewed?",
    body: "This removes AI and rule-generated tags. Tags you have explicitly locked or reviewed are kept. The action cannot be undone.",
    confirmLabel: "Reset AI & rule tags",
  },
  everything: {
    heading: "Reset everything?",
    body: "This removes every tag on every product — AI, rule, and human. You will need to re-tag your catalogue from scratch. The action cannot be undone.",
    confirmLabel: "Reset all tags",
  },
};

export function buildResetError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as ResetResponseData;
  if (d.ok) return null;
  if (d.error === "rate_limited") {
    const retry = d.retryAfterSeconds ?? 0;
    return `Reset is rate-limited. Try again in ${retry}s.`;
  }
  return d.error ?? null;
}

export function ResetConfirmBar({
  scope,
  isResetting,
  errorMessage,
  onCancel,
  onConfirm,
}: Props) {
  if (!scope) return null;
  const copy = RESET_COPY[scope];
  return (
    <>
      <style>{`
        .reset-bar {
          position: fixed;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1001;
          max-width: 560px;
          width: calc(100% - 32px);
          box-shadow: 0 6px 24px rgba(0,0,0,0.12);
          border-radius: 10px;
          overflow: hidden;
        }
      `}</style>
      <div className="reset-bar">
        <s-banner tone="warning" heading={copy.heading}>
          <s-paragraph>{copy.body}</s-paragraph>
          {errorMessage ? (
            <s-paragraph>
              <s-text tone="critical">{errorMessage}</s-text>
            </s-paragraph>
          ) : null}
          <s-stack direction="inline" gap="small-200">
            <s-button
              variant="primary"
              tone="critical"
              onClick={onConfirm}
              {...(isResetting ? { loading: true, disabled: true } : {})}
            >
              {copy.confirmLabel}
            </s-button>
            <s-button
              variant="tertiary"
              onClick={onCancel}
              {...(isResetting ? { disabled: true } : {})}
            >
              Cancel
            </s-button>
          </s-stack>
        </s-banner>
      </div>
    </>
  );
}
