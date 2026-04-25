// A single statistic card for the intelligence dashboard overview row.
//
// Shows a large number, a label, and an optional icon/tone/hint. The hint
// is rendered as an <s-tooltip> wired via interest-for — used e.g. for the
// "Coming in 006" label on the Active rules card.

export type StatCardTone =
  | "neutral"
  | "success"
  | "critical"
  | "info"
  | "subdued";

export type StatCardProps = {
  id: string;
  label: string;
  value: number | string;
  tone?: StatCardTone;
  icon?: string;
  hint?: string;
  // 006a §5.9: when set, the card becomes a link target. Used by the
  // Active rules card to navigate to /app/intelligence/rules.
  href?: string;
};

const TONE_BADGE: Record<
  StatCardTone,
  "success" | "critical" | "info" | "neutral" | undefined
> = {
  neutral: undefined,
  subdued: undefined,
  success: "success",
  critical: "critical",
  info: "info",
};

export function StatCard({
  id,
  label,
  value,
  tone = "neutral",
  icon,
  hint,
  href,
}: StatCardProps) {
  const dim = tone === "subdued";
  const tooltipId = hint ? `${id}-hint` : undefined;

  const card = (
    <s-box
      padding="base"
      borderWidth="base"
      borderRadius="base"
      background={dim ? "subdued" : "base"}
    >
      <style>{`
        .stat-card-${id} .stat-value { font-size: 28px; font-weight: 600; line-height: 1.1; }
        .stat-card-${id} .stat-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
        .stat-card-${id} .stat-row { display: flex; align-items: center; gap: 6px; }
        .stat-card-link-${id} { display: block; text-decoration: none; color: inherit; cursor: pointer; }
      `}</style>
      <div className={`stat-card-${id}`}>
        <div className="stat-value">
          {dim ? (
            <s-text color="subdued">{String(value)}</s-text>
          ) : (
            <s-text type="strong">{String(value)}</s-text>
          )}
        </div>
        <div className="stat-label stat-row">
          {icon ? <span aria-hidden>{icon}</span> : null}
          <s-text color="subdued">{label}</s-text>
          {tone !== "neutral" && tone !== "subdued" ? (
            <s-badge tone={TONE_BADGE[tone]}>•</s-badge>
          ) : null}
          {hint && tooltipId ? (
            <s-icon type="info" interest-for={tooltipId} />
          ) : null}
        </div>
      </div>
    </s-box>
  );

  return (
    <>
      {href ? (
        <a className={`stat-card-link-${id}`} href={href}>
          {card}
        </a>
      ) : (
        card
      )}
      {hint && tooltipId ? (
        <s-tooltip id={tooltipId}>{hint}</s-tooltip>
      ) : null}
    </>
  );
}
