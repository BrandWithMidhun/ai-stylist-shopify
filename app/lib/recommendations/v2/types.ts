// PR-3.1-mech.2: shared types for the v2 recommendation pipeline.
//
// These contracts are filled in incrementally across stages:
//   - mech.2 (this commit): Stage 1 populates the base columns of
//     CandidateProduct + a stage-1 StageContribution.
//   - mech.3: Stage 2 attaches `similarityDistance`.
//   - mech.4: Stage 3 attaches `rerankBoosts` (and consumes
//     QueryAttributes for re-rank inputs).
//   - mech.5: Stage 4 attaches `merchantSignals`; Stages 5-6 set
//     `finalScore` and `diversityPenalty`.
//
// QueryAttributes uses an index signature so Phase 5's per-mode
// re-rankers can extend without recompiling this file. The named
// fields are the primary surface for FASHION 3.1.
//
// StoreMode is imported from the existing store-axes module so this
// file does not bind a separate copy of the enum — single source of
// truth shared with the catalog layer.

import type { StoreMode } from "../../catalog/store-axes";

export type PipelineInput = {
  shopDomain: string;
  intent: string;
  priceMin?: number;
  priceMax?: number;
  // top-N output, default 6, hard cap 12
  limit?: number;
  // Stage 2 retrieval size, default 50, max 100
  candidatePoolSize?: number;
  profileId?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
};

export type QueryAttributes = {
  // Hard-filter axes (drive Stage 1).
  gender?: string[];
  category?: string[];
  // Soft-preference axes (drive Stage 3 re-rank).
  occasion?: string[];
  fit?: string[];
  color_family?: string[];
  style_type?: string[];
  sleeve_length?: string[];
  pattern?: string[];
  collar_type?: string[];
  season?: string[];
  // Allow extension without recompile when Phase 5 adds modes; the
  // explicit typed fields above are the primary surface.
  [axis: string]: string[] | undefined;
};

export type CandidateProduct = {
  id: string;
  handle: string;
  title: string;
  productType: string | null;
  vendor: string | null;
  featuredImageUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  recommendationPromoted: boolean;
  recommendationExcluded: boolean;
  // ProductTag relation (mech.4 addition). Stage 1 does NOT load tags
  // (D4 from mech.2: "no relation loads in Stage 1") — the orchestrator
  // (mech.6) is responsible for loading APPROVED ProductTag rows for the
  // candidates that survive Stage 2 and attaching them before Stage 3
  // runs. When tags is undefined, Stage 3 re-rankers gracefully return 0
  // for that candidate (no boost, no crash).
  tags?: Array<{ axis: string; value: string; status: string }>;
  // mech.5 addition: per-candidate sales velocity over a rolling 30-day
  // window. The Product.salesVelocity30d column does NOT exist in 3.1;
  // 3.2 adds it + a Stage 1 SQL update to load it. Stage 4 reads
  // candidate.salesVelocity30d ?? 0 — graceful no-data fallback.
  salesVelocity30d?: number;
  // Stage-specific augmentations attach here as the pipeline progresses.
  similarityDistance?: number; // mech.3
  rerankBoosts?: Record<string, number>; // mech.4
  merchantSignals?: { promoted?: number; velocity?: number }; // mech.5
  finalScore?: number;
  diversityPenalty?: number;
  // mech.5 additions:
  // - flaggedOos: structurally present in 3.1 but always undefined.
  //   Stage 1's EXISTS pre-filter handles steady-state OOS; the
  //   mid-pipeline-flip case (variant availability changes between
  //   Stage 1 and Stage 5) is unaddressed in 3.1 and recorded as
  //   operational debt at 3.1 close. mech.6 orchestrator may add a
  //   fresh availableForSale check on the surviving top-N candidates
  //   before Stage 5 runs; if implemented there, Stage 5 stays as-is.
  flaggedOos?: boolean;
  // - whyTrace: deterministic 1-2 sentence string Stage 6 generates from
  //   candidate.rerankBoosts + merchantSignals + similarityDistance.
  //   NOT an LLM call — fast and predictable. The agent's chat response
  //   paraphrases this in natural language; the structured trace lives
  //   on RecommendationEvent for audit.
  whyTrace?: string;
};

// PR-3.1-mech.4: customer profile snapshot for Stage 3 re-rankers.
//
// The orchestrator (mech.6) fetches CustomerProfileAttribute rows once
// per pipeline run and projects them into this shape; Stage 3 reads
// from the snapshot, never queries directly. Snapshot != schema —
// adding new profile fields here is a pure code change.
//
// All fields optional; an unset field signals "no profile preference
// for this axis", and the corresponding re-ranker treats it as a
// no-op rather than a hard filter.
//
// bodyType vocabulary: "apple" | "pear" | "hourglass" | "rectangle" |
// "inverted_triangle" — sourced from Phase 6's quiz output (not yet
// wired in 3.1; PR-D D.3 verifier confirmed the dev shop has zero
// CustomerProfileAttribute rows, so body-type re-ranker is a no-op
// in the current eval baseline).
//
// fitPreference / preferredColors / preferredOccasions: axis values
// from AXIS_OPTIONS.FASHION (fit / color_family / occasion).
export type CustomerProfileSnapshot = {
  bodyType?: string;
  fitPreference?: string;
  preferredColors?: string[];
  preferredOccasions?: string[];
};

export type StageContribution = {
  name: string;
  ms: number;
  candidatesIn: number;
  candidatesOut: number;
  meta?: Record<string, unknown>;
};

export type StageOutput = {
  candidates: CandidateProduct[];
  contribution: StageContribution;
};

export type TraceStage = StageContribution;

export type Trace = {
  version: string;
  intent: string;
  stages: TraceStage[];
  totalMs: number;
};

// mech.5 addition: ProductCard mirrors the legacy formatProductCard
// shape from app/lib/chat/tools/recommend-products.server.ts (the field
// set the agent and storefront widget already render against). v2's
// flip commit (post-eval-pass) swaps the agent's recommend_products
// tool registration; the wire format on the agent side does not change.
//
// traceContributions is a v2-specific addition that the agent doesn't
// read but RecommendationEvent.candidates persists for audit. Each
// entry records one stage's contribution magnitude for this candidate.
// `ms` is optional because mech.5 builds traceContributions from
// per-candidate fields without per-stage timing context — the
// orchestrator (mech.6) can populate ms from StageOutput.contribution
// when it stitches the full trace.
export type ProductCard = {
  id: string;
  handle: string;
  title: string;
  imageUrl: string | null;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  variantId: string | null;
  available: boolean;
  tags: string[]; // formatted as "axis:value" — same shape as legacy
  productUrl: string;
  // v2-only telemetry. Out of band from the agent's render path.
  traceContributions?: Array<{
    stage: string;
    contribution: number;
    ms?: number;
  }>;
  whyTrace?: string;
  finalScore?: number;
};

export type PipelineOutput = {
  products: ProductCard[];
  trace: Trace;
  topDistance: number | null;
  totalMs: number;
};

// Re-export StoreMode so callers can import it from this types module
// without dipping into the catalog layer for a type alone.
export type { StoreMode };

// PR-3.1-mech.6: dependency-injection seam for the orchestrator.
//
// Allows the integration test to substitute a mocked PrismaClient + a
// vi.fn() embedQuery; production callers in app/lib/chat/tools/recommend-
// products-v2.server.ts pass the real db.server prisma + embedQuery from
// app/lib/embeddings/voyage.server.ts (input_type="query"). The shape is
// intentionally narrow — only the surfaces the orchestrator itself
// touches. Stages 1+2 still hit prisma directly via their module-level
// imports; the test mocks db.server alongside this injection, so both
// paths land on the same hoisted mock.
//
// PrismaClient is the runtime client type from @prisma/client. Importing
// it as a type-only re-export keeps this file free of runtime imports
// from @prisma/client.
import type { PrismaClient } from "@prisma/client";

export type EmbedQueryFn = (text: string) => Promise<number[]>;

export type PipelineDeps = {
  prisma: PrismaClient;
  embedQuery: EmbedQueryFn;
};
