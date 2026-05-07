// PR-3.1-mech.6: v2 recommend_products tool stub.
//
// Mirrors the legacy tool's external interface (recommend-products.server.ts)
// so that the post-eval-pass flip commit lands as a one-line registry
// change in registry.server.ts. The tool definition (input_schema +
// description) is intentionally identical to the legacy tool so the agent
// behavior on the prompt side does not change when the flip happens.
//
// Deliberately NOT registered in registry.server.ts in mech.6 — the
// feature flag stays structural through this commit. This module is
// importable by tests + by the eval harness; the agent path keeps
// hitting the legacy tool.
//
// Side-effect on every successful call: writes one RecommendationEvent
// row (per locked decision D7). The orchestrator (pipeline.server.ts)
// stays pure-compute so the integration test does not need to mock
// RecommendationEvent. Errors are still recorded as RecommendationEvent
// rows with the trace's intent + an empty candidates array, so post-hoc
// audit captures the failure shape.
//
// SECURITY: shopDomain comes from ToolExecutionContext (route-scoped
// installed-shop verification), never from Claude's tool input. Same
// posture as the legacy tool.

import prisma from "../../../db.server";
import { embedQuery as voyageEmbedQuery } from "../../embeddings/voyage.server";
import { runPipeline } from "../../recommendations/v2/pipeline.server";
import type { PipelineInput } from "../../recommendations/v2/types";
import type {
  ProductCard,
  ToolDef,
  ToolExecutionContext,
  ToolResult,
} from "./types";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;
const CANDIDATE_POOL_SIZE = 50;
const PIPELINE_VERSION = "3.1.0";

export type RecommendProductsV2Input = {
  intent: string;
  price_min?: number;
  price_max?: number;
  limit?: number;
};

export const recommendProductsV2Tool: ToolDef = {
  name: "recommend_products",
  description:
    "Recommend products to the user using the v2 multi-stage pipeline (hard filters → semantic retrieval → re-rank → merchant signals → diversity). Use this when the user is open to suggestions: post-quiz auto-send, 'what should I get', 'anything for me', 'help me browse', 'recommend something'. Pass a RICH `intent` string that synthesizes the user's profile, lifestyle, and current message into one descriptive phrase — the embedding match is only as good as the intent. Example good intents: 'minimalist linen shirts for casual everyday wear, neutral colors', 'rose gold pendant necklace for daily wear, traditional aesthetic'. Avoid generic intents like 'shirts' or 'jewellery' — those waste the semantic signal. For specific keyword searches like 'linen kurta size XL', use `search_products` instead — it's better at literal title matching.",
  input_schema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        description:
          "Rich natural-language description of what the user is looking for. Synthesize the user's profile (gender, lifestyle, style vibe, color preferences) with their current message into one phrase. Better intent = better match.",
      },
      price_min: {
        type: "number",
        description: "Minimum price (optional). Same currency as the store.",
      },
      price_max: {
        type: "number",
        description: "Maximum price (optional). Same currency as the store.",
      },
      limit: {
        type: "number",
        description: `Max product cards to render (default ${DEFAULT_LIMIT}, hard cap ${MAX_LIMIT}). Pipeline always retrieves a ${CANDIDATE_POOL_SIZE}-product candidate pool internally.`,
      },
    },
    required: ["intent"],
  },
};

export async function recommendProductsV2(
  input: RecommendProductsV2Input,
  ctx: ToolExecutionContext,
): Promise<ToolResult> {
  const intent = input.intent?.trim();
  if (!intent) {
    return { ok: false, data: { error: "intent_required" } };
  }

  const cardLimit = Math.min(
    Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)),
    MAX_LIMIT,
  );

  const pipelineInput: PipelineInput = {
    shopDomain: ctx.shopDomain,
    intent,
    priceMin: input.price_min,
    priceMax: input.price_max,
    limit: cardLimit,
    candidatePoolSize: CANDIDATE_POOL_SIZE,
  };

  const startMs = Date.now();
  try {
    const out = await runPipeline(pipelineInput, {
      prisma,
      embedQuery: voyageEmbedQuery,
    });
    const latencyMs = Date.now() - startMs;
    const topCards = out.products.slice(0, cardLimit);

    // Slim summary back to Claude — mirrors legacy tool's slim shape so
    // the agent's downstream prompt math doesn't shift between v1 and v2.
    const slim = topCards.map((c) => ({
      id: c.id,
      title: c.title,
      price: c.price,
      currency: c.currency,
      available: c.available,
      tags: c.tags,
    }));

    await writeRecommendationEvent({
      shopDomain: ctx.shopDomain,
      intent,
      products: topCards,
      trace: out.trace as unknown as Record<string, unknown>,
      topDistance: out.topDistance,
      latencyMs,
    });

    // eslint-disable-next-line no-console, no-undef
    console.log("[recommend_products_v2]", {
      shop: ctx.shopDomain,
      intent,
      priceMin: input.price_min,
      priceMax: input.price_max,
      candidatesReturned: topCards.length,
      topDistance: out.topDistance,
      pipelineMs: out.totalMs,
      stages: out.trace.stages.map((s) => ({ name: s.name, ms: s.ms })),
    });

    return {
      ok: true,
      data: {
        products: slim,
        total: topCards.length,
        topDistance: out.topDistance,
        query: input,
      },
      products: topCards,
    };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    const errorClass = err instanceof Error ? err.constructor.name : "Unknown";
    const errorMessage = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console, no-undef
    console.error("[recommend_products_v2] failed", {
      shop: ctx.shopDomain,
      intent,
      errorClass,
      errorMessage,
    });
    await writeRecommendationEvent({
      shopDomain: ctx.shopDomain,
      intent,
      products: [],
      trace: {
        version: PIPELINE_VERSION,
        intent,
        stages: [],
        totalMs: latencyMs,
        error: { class: errorClass, message: errorMessage },
      },
      topDistance: null,
      latencyMs,
    }).catch(() => {
      // Last-ditch: an audit-write failure must not mask the original
      // pipeline error from the caller.
    });
    throw err;
  }
}

async function writeRecommendationEvent(args: {
  shopDomain: string;
  intent: string;
  products: ProductCard[];
  trace: Record<string, unknown>;
  topDistance: number | null;
  latencyMs: number;
}): Promise<void> {
  await prisma.recommendationEvent.create({
    data: {
      shopDomain: args.shopDomain,
      intent: args.intent,
      candidates: args.products as unknown as object,
      trace: args.trace as unknown as object,
      traceVersion: PIPELINE_VERSION,
      topDistance: args.topDistance,
      latencyMs: args.latencyMs,
    },
  });
}
