// PR-3.1-mech.1: pipeline-eval CLI entry point.
//
// Usage:
//   npx tsx scripts/run-eval.ts --all
//   npx tsx scripts/run-eval.ts --fixture=<key>
//   npx tsx scripts/run-eval.ts --all --shop=<domain>
//
// Default --shop is ai-fashion-store.myshopify.com.
//
// Exit codes:
//   0 — harness completed without error (mech.1: all 12 results FAIL by
//       construction because NoOpPipelineRunner returns no products).
//       The threshold check (aggregate ≥ 0.70) is intentionally NOT
//       enforced in mech.1 — the empty-baseline run is a plumbing
//       smoke test, not a quality gate. mech.6 will land the threshold
//       enforcement once the real pipeline produces its first real
//       baseline.
//   1 — fatal error (DB connection failure, no fixtures synced, etc.)
//   2 — argument error (printed alongside --help text)

import { runEval } from "../app/lib/recommendations/v2/eval/cli";
import prisma from "../app/db.server";

type Args = {
  shopDomain?: string;
  fixtureKey?: string;
  all: boolean;
};

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage: tsx scripts/run-eval.ts (--all | --fixture=<key>) [--shop=<domain>]",
      "",
      "  --all              Run every fixture for the shop.",
      "  --fixture=<key>    Run a single fixture by its fixtureKey.",
      "  --shop=<domain>    Default: ai-fashion-store.myshopify.com",
      "",
      "Run scripts/eval-fixtures-sync.ts first to populate EvalQuery rows.",
    ].join("\n"),
  );
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let shopDomain: string | undefined;
  let fixtureKey: string | undefined;
  let all = false;
  for (const arg of argv) {
    if (arg.startsWith("--shop=")) {
      shopDomain = arg.slice("--shop=".length).trim();
    } else if (arg.startsWith("--fixture=")) {
      fixtureKey = arg.slice("--fixture=".length).trim();
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      // eslint-disable-next-line no-console
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  if (!all && !fixtureKey) {
    // eslint-disable-next-line no-console
    console.error("error: pass either --all or --fixture=<key>");
    printHelp();
    process.exit(2);
  }
  return { shopDomain, fixtureKey, all };
}

async function main(): Promise<void> {
  const { shopDomain, fixtureKey, all } = parseArgs();
  try {
    const summary = await runEval({ shopDomain, fixtureKey, all });
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log(`EvalRun ${summary.runId}`);
    // eslint-disable-next-line no-console
    console.log(`  shopDomain:      ${summary.shopDomain}`);
    // eslint-disable-next-line no-console
    console.log(`  pipelineVersion: ${summary.pipelineVersion}`);
    // eslint-disable-next-line no-console
    console.log(`  totalQueries:    ${summary.totalQueries}`);
    // eslint-disable-next-line no-console
    console.log(
      `  pass / partial / fail: ${summary.passCount} / ${summary.partialCount} / ${summary.failCount}`,
    );
    // eslint-disable-next-line no-console
    console.log(`  aggregateScore:  ${summary.aggregateScore.toFixed(4)}`);
    // eslint-disable-next-line no-console
    console.log(`  durationMs:      ${summary.durationMs}`);
    // eslint-disable-next-line no-console
    console.log("");
    for (const f of summary.perFixture) {
      const score = f.score.toFixed(4);
      const precision = f.precisionAtK.toFixed(2);
      const relaxed = f.relaxedMatchAtK.toFixed(2);
      // eslint-disable-next-line no-console
      console.log(
        `  [${f.status}] ${f.fixtureKey} → score=${score} (precision=${precision}, relaxed=${relaxed}, latencyMs=${f.pipelineLatencyMs})`,
      );
      if (f.errorMessage) {
        // eslint-disable-next-line no-console
        console.log(`         error: ${f.errorMessage}`);
      }
    }
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[run-eval] failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
