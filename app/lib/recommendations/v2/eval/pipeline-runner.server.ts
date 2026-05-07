// PR-3.1-mech.6: real PipelineRunner for the eval harness.
//
// Wraps the v2 orchestrator (pipeline.server.ts) behind the
// PipelineRunner interface mech.1 defined. Each fixture run hits
// real Prisma + real Voyage embedQuery — this is the runner the
// baseline eval invocation against the dev shop's Railway DB uses.
//
// The eval harness's NoOpPipelineRunner stays available via the
// scripts/run-eval.ts --runner=noop flag for empty-baseline parity if
// it ever needs to reproduce mech.1's plumbing-only run shape.
//
// Per locked decision D7: this runner does NOT write a
// RecommendationEvent row. Eval runs are not user-facing; only the v2
// tool stub (recommend-products-v2.server.ts) writes events. EvalRun +
// EvalResult rows produced by the harness are the eval-side audit
// trail.

import prisma from "../../../../db.server";
import { embedQuery as voyageEmbedQuery } from "../../../embeddings/voyage.server";
import { runPipeline } from "../pipeline.server";
import type {
  PipelineRunInput,
  PipelineRunOutput,
  PipelineRunner,
} from "./runner.server";
import type { ProductWithTags } from "./scoring";

export class RealPipelineRunner implements PipelineRunner {
  async run(input: PipelineRunInput): Promise<PipelineRunOutput> {
    const out = await runPipeline(
      {
        shopDomain: input.shopDomain,
        intent: input.intent,
        limit: input.k,
      },
      {
        prisma,
        embedQuery: voyageEmbedQuery,
      },
    );

    // Project the orchestrator's ProductCard[] into the eval harness's
    // ProductWithTags shape. ProductCard.tags is "axis:value"; the
    // scoring layer wants {axis, value} objects so it can run relaxed-
    // match against expectedTagFilters per-axis.
    const products: ProductWithTags[] = out.products.map((p) => ({
      handle: p.handle,
      tags: p.tags
        .map((t) => {
          const idx = t.indexOf(":");
          if (idx <= 0) return null;
          return { axis: t.slice(0, idx), value: t.slice(idx + 1) };
        })
        .filter((t): t is { axis: string; value: string } => t !== null),
    }));

    return {
      products,
      topDistance: out.topDistance,
      totalMs: out.totalMs,
      trace: out.trace as unknown as Record<string, unknown>,
    };
  }
}
