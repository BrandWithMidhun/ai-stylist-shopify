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
  // Stage-specific augmentations attach here as the pipeline progresses.
  similarityDistance?: number; // mech.3
  rerankBoosts?: Record<string, number>; // mech.4
  merchantSignals?: { promoted?: number; velocity?: number }; // mech.5
  finalScore?: number;
  diversityPenalty?: number;
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

export type PipelineOutput = {
  products: CandidateProduct[];
  trace: Trace;
  topDistance: number | null;
  totalMs: number;
};

// Re-export StoreMode so callers can import it from this types module
// without dipping into the catalog layer for a type alone.
export type { StoreMode };
