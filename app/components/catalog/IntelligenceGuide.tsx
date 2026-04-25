// Always-visible guide block for the intelligence dashboard.
//
// Spec §6.3: header bar with tagged%, intro paragraph, 4 step cards in a
// 2x2 / 4x1 grid, filter legend panel. CTAs for features not yet built
// (Train system, Review queue, Stock sync cron) are disabled and render
// a "Coming in 006" tooltip. No dismissal in 005c per user decision.

type Step = {
  id: string;
  title: string;
  body: string;
  cta: string;
  disabled: boolean;
  tooltip?: string;
};

const STEPS: Step[] = [
  {
    id: "auto-tag",
    title: "1. Auto-tag with AI",
    body: "Let Claude read each product and propose a first pass of tags across category, style, colour, occasion and more.",
    cta: "Tag pending products",
    disabled: false,
  },
  {
    id: "review",
    title: "2. Review & correct",
    body: "Walk the review queue to lock the tags that matter. A human-reviewed product teaches the system for future tagging.",
    cta: "Open review queue",
    disabled: true,
    tooltip: "Coming in Feature 006",
  },
  {
    id: "train",
    title: "3. Train the system",
    body: "Turn the corrections you make into rules Claude will apply automatically on the next run.",
    cta: "Train system",
    disabled: true,
    tooltip: "Coming in Feature 006",
  },
  {
    id: "stock",
    title: "4. Keep stock fresh",
    body: "Sync inventory on a schedule so recommendations never surface sold-out products.",
    cta: "Configure stock sync",
    disabled: true,
    tooltip: "Coming in Feature 006",
  },
];

type LegendItem = { label: string; body: string };
const LEGEND: LegendItem[] = [
  { label: "Occasion", body: "When the product is worn (work, weekend, evening)." },
  { label: "Category", body: "What the product is (shirt, dress, jacket)." },
  { label: "Style type", body: "The overall mood (classic, streetwear, minimalist)." },
  { label: "Fit", body: "How it sits on the body (regular, slim, oversized)." },
  { label: "Statement piece", body: "Whether it anchors an outfit or supports one." },
];

type Props = {
  tagCoveragePercent: number;
  onAutoTag: () => void;
  autoTagDisabled: boolean;
};

export function IntelligenceGuide({
  tagCoveragePercent,
  onAutoTag,
  autoTagDisabled,
}: Props) {
  return (
    <s-section>
      <style>{`
        .guide-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
        .guide-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; }
        .guide-legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 12px; }
      `}</style>
      <div className="guide-header">
        <s-heading>
          <span aria-hidden>🎓 </span>
          How to build great Product Intelligence
        </s-heading>
        <s-badge tone="info">{tagCoveragePercent}% tagged</s-badge>
      </div>
      <s-paragraph>
        Product intelligence is the layer that lets the AI stylist understand
        your catalogue. Four steps take you from a fresh sync to a fully
        learning system.
      </s-paragraph>
      <div className="guide-steps">
        {STEPS.map((step) => (
          <GuideStepCard
            key={step.id}
            step={step}
            onAutoTag={onAutoTag}
            autoTagDisabled={autoTagDisabled}
          />
        ))}
      </div>
      <s-heading>Filter legend</s-heading>
      <s-paragraph>
        The filter sidebar groups products along the axes the AI uses when
        recommending.
      </s-paragraph>
      <div className="guide-legend">
        {LEGEND.map((item) => (
          <s-box
            key={item.label}
            padding="small-300"
            borderWidth="base"
            borderRadius="base"
          >
            <s-text type="strong">{item.label}</s-text>
            <s-paragraph>
              <s-text color="subdued">{item.body}</s-text>
            </s-paragraph>
          </s-box>
        ))}
      </div>
    </s-section>
  );
}

function GuideStepCard({
  step,
  onAutoTag,
  autoTagDisabled,
}: {
  step: Step;
  onAutoTag: () => void;
  autoTagDisabled: boolean;
}) {
  const tooltipId = step.tooltip ? `guide-${step.id}-tip` : undefined;
  const isAutoTagStep = step.id === "auto-tag";
  const handleClick = isAutoTagStep ? onAutoTag : undefined;
  const disabled = isAutoTagStep ? autoTagDisabled : step.disabled;
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{step.title}</s-text>
        <s-paragraph>
          <s-text color="subdued">{step.body}</s-text>
        </s-paragraph>
        <s-stack direction="inline" gap="small-200" alignItems="center">
          <s-button
            {...(disabled ? { disabled: true } : {})}
            onClick={handleClick}
          >
            {step.cta}
          </s-button>
          {/* 006a Decision 8: discoverability link to rules. Lives on the
              auto-tag card so the empty-catalog flow surfaces it. */}
          {isAutoTagStep ? (
            <s-link href="/app/intelligence/rules">Set up rules</s-link>
          ) : null}
          {tooltipId ? (
            <>
              <s-icon type="info" interest-for={tooltipId} />
              <s-tooltip id={tooltipId}>{step.tooltip}</s-tooltip>
            </>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}
