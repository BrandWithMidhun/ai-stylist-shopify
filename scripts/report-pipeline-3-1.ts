// PR-3.1-mech.1: stub reporter for the most recent EvalRun.
//
// mech.1 ships a one-section run-summary view (the empty-baseline
// EvalRun and its 12 EvalResult rows). mech.6 fleshes this script
// out into the full closure-evidence reporter (latency-distribution,
// pipeline-stage-shape, sample-audit, eval-baseline, run-summary).
//
// Usage:
//   npx tsx scripts/report-pipeline-3-1.ts
//   npx tsx scripts/report-pipeline-3-1.ts --shop=ai-fashion-store.myshopify.com

import prisma from "../app/db.server";

const DEFAULT_SHOP = "ai-fashion-store.myshopify.com";

function parseShopArg(): string {
  const arg = process.argv.find((a) => a.startsWith("--shop="));
  if (arg) return arg.slice("--shop=".length).trim() || DEFAULT_SHOP;
  return DEFAULT_SHOP;
}

async function main(): Promise<void> {
  const shopDomain = parseShopArg();
  const lastRun = await prisma.evalRun.findFirst({
    where: { shopDomain },
    orderBy: { createdAt: "desc" },
  });
  if (!lastRun) {
    // eslint-disable-next-line no-console
    console.log(`No EvalRun rows found for shop ${shopDomain}.`);
    await prisma.$disconnect();
    process.exit(0);
    return;
  }
  const results = await prisma.evalResult.findMany({
    where: { runId: lastRun.id },
    include: { query: true },
    orderBy: { createdAt: "asc" },
  });

  // eslint-disable-next-line no-console
  console.log("=== Phase 3 Sub-bundle 3.1 — most recent EvalRun ===");
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log(`runId:           ${lastRun.id}`);
  // eslint-disable-next-line no-console
  console.log(`shopDomain:      ${lastRun.shopDomain}`);
  // eslint-disable-next-line no-console
  console.log(`kind:            ${lastRun.kind}`);
  // eslint-disable-next-line no-console
  console.log(`pipelineVersion: ${lastRun.pipelineVersion}`);
  // eslint-disable-next-line no-console
  console.log(`createdAt:       ${lastRun.createdAt.toISOString()}`);
  // eslint-disable-next-line no-console
  console.log(`totalQueries:    ${lastRun.totalQueries}`);
  // eslint-disable-next-line no-console
  console.log(
    `pass / partial / fail: ${lastRun.passCount} / ${lastRun.partialCount} / ${lastRun.failCount}`,
  );
  // eslint-disable-next-line no-console
  console.log(`aggregateScore:  ${lastRun.aggregateScore.toFixed(4)}`);
  // eslint-disable-next-line no-console
  console.log(`durationMs:      ${lastRun.durationMs}`);
  // eslint-disable-next-line no-console
  console.log(`gitSha:          ${lastRun.gitSha ?? "(unset)"}`);
  // eslint-disable-next-line no-console
  console.log("");
  // eslint-disable-next-line no-console
  console.log("Per-fixture results:");
  for (const r of results) {
    const score = r.score.toFixed(4);
    const precision = r.precisionAtK.toFixed(2);
    const relaxed = r.relaxedMatchAtK.toFixed(2);
    // eslint-disable-next-line no-console
    console.log(
      `  [${r.status}] ${r.query.fixtureKey} → score=${score} (precision=${precision}, relaxed=${relaxed}, latencyMs=${r.pipelineLatencyMs}, topK=${r.topKHandles.length})`,
    );
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[report-pipeline-3-1] failed:", err);
  process.exit(1);
});
