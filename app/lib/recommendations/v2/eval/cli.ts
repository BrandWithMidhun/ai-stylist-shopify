// PR-3.1-mech.1: eval CLI dispatcher (library-shaped, callable from
// scripts/run-eval.ts and from future integration tests).
//
// Flow:
//   1. Resolve fixtures by (shopDomain, fixtureKey) when --fixture is
//      passed, or all rows for shopDomain when --all.
//   2. For each fixture, run the PipelineRunner (default
//      NoOpPipelineRunner — mech.1 baseline; later mechs inject real
//      runners as stages land) and score via runFixtureAgainstPipeline.
//   3. Persist exactly one EvalRun row + one EvalResult per fixture.
//      Both writes happen in a single $transaction so partial state
//      never leaks if Prisma blows up mid-loop.
//
// The CLI returns a RunEvalSummary regardless of pass/fail so the
// caller can render the report. Process exit codes are decided in
// scripts/run-eval.ts.

import prisma from "../../../../db.server";
import { RealPipelineRunner } from "./pipeline-runner.server";
import {
  NoOpPipelineRunner,
  runFixtureAgainstPipeline,
  type FixtureRunResult,
  type PipelineRunner,
} from "./runner.server";

const DEFAULT_SHOP = "ai-fashion-store.myshopify.com";
const PIPELINE_VERSION_EMPTY = "3.1.0-empty";
const PIPELINE_VERSION_REAL = "3.1.0";

export type RunEvalArgs = {
  shopDomain?: string;
  fixtureKey?: string;
  all?: boolean;
  triggeredBy?: string;
  pipelineVersion?: string;
  // Allows tests + future mechs to inject a real pipeline. Defaults
  // to NoOpPipelineRunner so mech.1's empty-baseline run produces
  // 12 FAIL results by construction.
  runner?: PipelineRunner;
};

export type RunEvalSummary = {
  runId: string;
  shopDomain: string;
  pipelineVersion: string;
  totalQueries: number;
  passCount: number;
  partialCount: number;
  failCount: number;
  aggregateScore: number;
  durationMs: number;
  perFixture: Array<{
    fixtureKey: string;
    status: string;
    score: number;
    precisionAtK: number;
    relaxedMatchAtK: number;
    topKHandles: string[];
    pipelineLatencyMs: number;
    errorMessage?: string;
  }>;
};

export async function runEval(args: RunEvalArgs): Promise<RunEvalSummary> {
  const shopDomain = args.shopDomain ?? DEFAULT_SHOP;
  // PR-3.1-mech.6: default flips from NoOpPipelineRunner to
  // RealPipelineRunner. Tests + the --runner=noop CLI flag (added in
  // scripts/run-eval.ts) keep the empty-baseline path available for
  // plumbing reproductions. pipelineVersion default tracks the runner:
  // real → "3.1.0", noop → "3.1.0-empty".
  const runner = args.runner ?? new RealPipelineRunner();
  const isNoOpRunner = runner instanceof NoOpPipelineRunner;
  const pipelineVersion =
    args.pipelineVersion ??
    (isNoOpRunner ? PIPELINE_VERSION_EMPTY : PIPELINE_VERSION_REAL);
  const triggeredBy = args.triggeredBy ?? "CLI";

  if (!args.all && !args.fixtureKey) {
    throw new Error("runEval requires either { all: true } or { fixtureKey }");
  }

  const where: { shopDomain: string; fixtureKey?: string } = { shopDomain };
  if (args.fixtureKey) where.fixtureKey = args.fixtureKey;

  const queries = await prisma.evalQuery.findMany({
    where,
    orderBy: { fixtureKey: "asc" },
  });
  if (queries.length === 0) {
    throw new Error(
      `No EvalQuery rows found for shop ${shopDomain}` +
        (args.fixtureKey ? ` and fixtureKey ${args.fixtureKey}` : "") +
        ". Run scripts/eval-fixtures-sync.ts first.",
    );
  }

  const startMs = Date.now();
  const fixtureRuns: FixtureRunResult[] = [];
  for (const query of queries) {
    const out = await runFixtureAgainstPipeline(query, runner);
    fixtureRuns.push(out);
  }
  const durationMs = Date.now() - startMs;

  let pass = 0;
  let partial = 0;
  let fail = 0;
  let scoreSum = 0;
  for (const r of fixtureRuns) {
    if (r.status === "PASS") pass += 1;
    else if (r.status === "PARTIAL") partial += 1;
    else fail += 1;
    scoreSum += r.score;
  }
  const aggregateScore = queries.length > 0 ? scoreSum / queries.length : 0;

  // eslint-disable-next-line no-undef
  const gitSha = process.env.RAILWAY_GIT_COMMIT_SHA ?? null;

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.evalRun.create({
      data: {
        shopDomain,
        kind: "PIPELINE",
        pipelineVersion,
        totalQueries: queries.length,
        passCount: pass,
        partialCount: partial,
        failCount: fail,
        aggregateScore,
        durationMs,
        triggeredBy,
        gitSha,
      },
    });
    for (const r of fixtureRuns) {
      await tx.evalResult.create({
        data: {
          runId: created.id,
          queryId: r.queryId,
          status: r.status,
          score: r.score,
          precisionAtK: r.precisionAtK,
          relaxedMatchAtK: r.relaxedMatchAtK,
          topKHandles: r.topKHandles,
          // topKTagsJson stores the per-product (handle, tags) shape
          // for offline diff inspection — the topKTags shape from
          // FixtureRunResult is already JSON-serialisable.
          topKTagsJson: r.topKTags as unknown as object,
          pipelineLatencyMs: r.pipelineLatencyMs,
        },
      });
    }
    return created;
  });

  return {
    runId: run.id,
    shopDomain,
    pipelineVersion,
    totalQueries: queries.length,
    passCount: pass,
    partialCount: partial,
    failCount: fail,
    aggregateScore,
    durationMs,
    perFixture: fixtureRuns.map((r) => ({
      fixtureKey: r.fixtureKey,
      status: r.status,
      score: r.score,
      precisionAtK: r.precisionAtK,
      relaxedMatchAtK: r.relaxedMatchAtK,
      topKHandles: r.topKHandles,
      pipelineLatencyMs: r.pipelineLatencyMs,
      errorMessage: r.errorMessage,
    })),
  };
}
