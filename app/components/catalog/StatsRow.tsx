// Responsive grid of StatCards for the intelligence dashboard.
//
// Uses CSS grid `auto-fit` so the 8 cards flow naturally: 4 cols on desktop,
// 2 on tablet, 1 on mobile — driven by the 180px minimum column width.

import { StatCard } from "./StatCard";
import type { DashboardStats } from "../../lib/catalog/stats.server";

type Props = {
  stats: DashboardStats;
};

export function StatsRow({ stats }: Props) {
  const cards = buildCards(stats);
  return (
    <s-section>
      <style>{`
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
      `}</style>
      <div className="stats-grid">
        {cards.map((c) => (
          <StatCard key={c.id} {...c} />
        ))}
      </div>
    </s-section>
  );
}

function buildCards(stats: DashboardStats) {
  return [
    {
      id: "total",
      label: "Total products",
      value: stats.totalProducts,
      tone: "neutral" as const,
    },
    {
      id: "live",
      label: "Live",
      value: stats.live,
      tone: "success" as const,
    },
    {
      id: "oos",
      label: "Out of stock",
      value: stats.outOfStock,
      tone: "critical" as const,
      icon: "⚠",
    },
    {
      id: "draft",
      label: "Draft",
      value: stats.draft,
      tone: "neutral" as const,
      icon: "📦",
    },
    {
      id: "pending",
      label: "Pending tag",
      value: stats.pendingTag,
      tone: "neutral" as const,
    },
    {
      id: "ai-rule",
      label: "AI / Rule generated",
      value: stats.aiOrRuleTagged,
      tone: "info" as const,
    },
    {
      id: "human",
      label: "Human reviewed",
      value: stats.humanReviewed,
      tone: "success" as const,
    },
    {
      id: "rules",
      label: "Active rules",
      value: stats.activeRules,
      tone: "subdued" as const,
      hint: "Coming in Feature 006",
    },
  ];
}
