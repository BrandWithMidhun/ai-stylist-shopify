// PR-3.1-mech.1: pipeline-eval runner.
//
// Wraps a PipelineRunner against a single EvalQuery fixture and returns
// a scored FixtureRunResult. The PipelineRunner interface is the seam
// the rest of 3.1 evolves through: mech.1 ships only NoOpPipelineRunner
// (returns empty top-K — the harness plumbing test); mech.2-6 swap in
// real pipeline runners as Stage 1 → Stage 6 land. The eval harness
// itself does not change once mech.1 ships.
//
// Errors surface as FAIL with score=0 + errorMessage on the result —
// the harness must never crash on a fixture-level failure (one bad
// fixture should not abort an aggregate run).

import type { EvalQuery } from "@prisma/client";
import {
  classifyStatus,
  combinedScore,
  precisionAtK,
  relaxedMatchAtK,
  type ProductWithTags,
} from "./scoring";

export type PipelineRunInput = {
  shopDomain: string;
  intent: string;
  k: number;
};

export type PipelineRunOutput = {
  // The top-K products the pipeline produced, ordered. Each product
  // carries its APPROVED tags so relaxedMatchAtK can score against
  // expectedTagFilters without a second DB roundtrip.
  products: ProductWithTags[];
  topDistance: number | null;
  totalMs: number;
  // Versioned trace JSON. mech.1 ships {version: "3.1.0-empty",
  // stages: []}; mech.6 swaps in the real Stage 0-6 contributions.
  trace: Record<string, unknown>;
};

export interface PipelineRunner {
  run(input: PipelineRunInput): Promise<PipelineRunOutput>;
}

// NoOpPipelineRunner: the empty-baseline harness driver. Returns no
// products. Lets mech.1 verify the eval-harness plumbing end-to-end
// before any pipeline stage exists. Every fixture run with this
// runner produces status=FAIL score=0 by construction.
export class NoOpPipelineRunner implements PipelineRunner {
  async run(input: PipelineRunInput): Promise<PipelineRunOutput> {
    return {
      products: [],
      topDistance: null,
      totalMs: 0,
      trace: {
        version: "3.1.0-empty",
        intent: input.intent,
        stages: [],
        totalMs: 0,
      },
    };
  }
}

export type FixtureRunResult = {
  queryId: string;
  fixtureKey: string;
  status: "PASS" | "PARTIAL" | "FAIL";
  score: number;
  precisionAtK: number;
  relaxedMatchAtK: number;
  topKHandles: string[];
  topKTags: ProductWithTags[];
  pipelineLatencyMs: number;
  errorMessage?: string;
};

export async function runFixtureAgainstPipeline(
  fixture: EvalQuery,
  runner: PipelineRunner,
): Promise<FixtureRunResult> {
  const k = fixture.k ?? 6;
  const expectedHandles = fixture.expectedHandles ?? [];
  const expectedTagFilters = (fixture.expectedTagFilters as Record<
    string,
    string[]
  > | null) ?? {};

  let products: ProductWithTags[] = [];
  let pipelineLatencyMs = 0;
  let errorMessage: string | undefined;

  try {
    const out = await runner.run({
      shopDomain: fixture.shopDomain,
      intent: fixture.intent,
      k,
    });
    products = out.products;
    pipelineLatencyMs = out.totalMs;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const topK = products.slice(0, k);
  const actualHandles = topK.map((p) => p.handle);
  const precision = precisionAtK(actualHandles, expectedHandles);
  const relaxed = relaxedMatchAtK(topK, expectedTagFilters, k);
  const score = combinedScore(precision, relaxed, expectedHandles.length > 0);
  const status = errorMessage ? "FAIL" : classifyStatus(score);

  return {
    queryId: fixture.id,
    fixtureKey: fixture.fixtureKey,
    status,
    score,
    precisionAtK: precision,
    relaxedMatchAtK: relaxed,
    topKHandles: actualHandles,
    topKTags: topK,
    pipelineLatencyMs,
    errorMessage,
  };
}
