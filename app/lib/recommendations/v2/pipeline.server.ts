// PR-3.1-mech.6: v2 recommendation pipeline orchestrator.
//
// Wires Stage 0 (query extraction) → Stage 1 (hard filters) → Stage 2
// (embedQuery + semantic retrieval) → Stage 2.5 (tag load) → Stage 3
// (rerank) → Stage 4 (merchant signals) → Stage 5 (diversity) → Stage 6
// (output formatting + finalScore + whyTrace), into one PipelineOutput
// with a Trace recording each stage's contribution and total wall-clock.
//
// Locked decisions (mech.6 prompt §"LOCKED DECISIONS"):
//
//   D1. Tag-load happens BETWEEN Stage 2 and Stage 3. Stage 3 is the
//       first stage to read candidate.tags; loading earlier would waste
//       DB work on candidates Stage 1's hard filter or Stage 2's
//       semantic narrowing eliminate.
//
//   D2. embedQuery is called exactly once, between Stage 1 and Stage 2,
//       AFTER the empty-Stage-1 short-circuit (no Voyage cost when
//       Stage 1 returns nothing). input_type="query" is enforced by
//       the production embedQuery fn import; the orchestrator stays
//       payload-agnostic via the EmbedQueryFn injection.
//
//   D6. The orchestrator does NOT modify registry.server.ts. It is
//       importable by tests and by the eval-harness PipelineRunner; the
//       agent's tool registration continues to point at the legacy
//       recommend-products tool until the post-eval-pass flip commit.
//
//   D7. RecommendationEvent writes happen in the v2 tool stub
//       (recommend-products-v2.server.ts), NOT here. Keeping the
//       orchestrator pure-compute (no side-effect writes) is what makes
//       the integration test cheap to mock.
//
// Empty-Stage-1 short-circuit returns a PipelineOutput with trace
// containing stages 0 + 1 only (no embedQuery call, no Stage 2+ entry).
// This matches the planning doc's "empty input → trivial trace" guidance
// and keeps the assertion shape predictable for the integration test.
//
// totalMs is wall-clock (end - start), not the sum of stage ms — gives
// honest end-to-end latency including the orchestrator's own overhead
// (prisma roundtrips for tag-load + merchant-config lookup, etc.).

import { stage1HardFilters } from "./stage-1-hard-filters.server";
import { stage2SemanticRetrieval } from "./stage-2-semantic-retrieval.server";
import { extractQueryAttributes } from "./stage-3-rerank/query-extraction.server";
import { rerank } from "./stage-3-rerank/index.server";
import { stage4MerchantSignals } from "./stage-4-merchant-signals.server";
import { stage5Diversity } from "./stage-5-diversity.server";
import {
  formatProductCard,
  stage6Output,
  type ShopMeta,
} from "./stage-6-output.server";
import type { StoreMode } from "../../catalog/store-axes";
import type {
  CandidateProduct,
  CustomerProfileSnapshot,
  PipelineDeps,
  PipelineInput,
  PipelineOutput,
  ProductCard,
  StageContribution,
  Trace,
} from "./types";

const PIPELINE_VERSION = "3.1.0";
const DEFAULT_LIMIT = 6;
const HARD_LIMIT = 12;
const DEFAULT_CANDIDATE_POOL = 50;
const MAX_CANDIDATE_POOL = 100;

const STAGE_QUERY_EXTRACTION = "stage-0-query-extraction";
const STAGE_TAG_LOAD = "stage-2.5-tag-load";

export async function runPipeline(
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<PipelineOutput> {
  const wallStartMs = Date.now();
  const stages: StageContribution[] = [];

  // --- Pre-stage: shop config + (optional) profile snapshot. ---------
  // mode + shopName drive Stage 3 dispatch and Stage 6 whyTrace
  // formatting respectively. Single MerchantConfig roundtrip — if the
  // shop has no row, default to GENERAL mode + shopDomain as display
  // name (the v2 tool stub tests this branch, eval harness hits a real
  // row).
  const config = await deps.prisma.merchantConfig.findUnique({
    where: { shop: input.shopDomain },
    select: { storeMode: true, shopDisplayName: true },
  });
  const mode: StoreMode = (config?.storeMode as StoreMode) ?? "GENERAL";
  const shopMeta: ShopMeta = {
    shopName: config?.shopDisplayName ?? input.shopDomain,
  };

  const profile = await loadProfileSnapshot(deps, input.profileId ?? null);

  // --- Stage 0: query extraction (heuristic, no LLM). ----------------
  const stage0StartMs = Date.now();
  const queryAttributes = extractQueryAttributes(
    input.intent,
    mode,
    profile ?? undefined,
  );
  const stage0Ms = Date.now() - stage0StartMs;
  stages.push({
    name: STAGE_QUERY_EXTRACTION,
    ms: stage0Ms,
    candidatesIn: 0,
    candidatesOut: 0,
    meta: {
      mode,
      extractedAxesCount: Object.keys(queryAttributes).length,
      profileApplied: profile != null,
    },
  });

  // --- Stage 1: hard filters. -----------------------------------------
  const stage1Out = await stage1HardFilters(input, queryAttributes, mode);
  stages.push(stage1Out.contribution);

  if (stage1Out.candidates.length === 0) {
    // Short-circuit: no candidates → no embedQuery, no Stage 2+, empty
    // PipelineOutput. Trace records stages 0 + 1 only.
    return buildEmptyOutput({
      intent: input.intent,
      stages,
      wallStartMs,
    });
  }

  // --- Stage 2: embedQuery + semantic retrieval. ----------------------
  const queryVector = await deps.embedQuery(input.intent);
  const candidatePoolSize = clampPoolSize(input.candidatePoolSize);
  const stage2Out = await stage2SemanticRetrieval(
    stage1Out.candidates,
    queryVector,
    candidatePoolSize,
  );
  stages.push(stage2Out.contribution);

  // --- Stage 2.5: tag load. -------------------------------------------
  // Single Prisma roundtrip: load APPROVED ProductTag rows for every
  // candidate that survived Stage 2. Group in JS by productId and
  // attach as candidate.tags before passing to Stage 3.
  const tagLoadStartMs = Date.now();
  const surviving = stage2Out.candidates;
  const taggedCandidates = await loadAndAttachTags(deps, surviving);
  const tagLoadMs = Date.now() - tagLoadStartMs;
  const totalTagRowsLoaded = taggedCandidates.reduce(
    (sum, c) => sum + (c.tags?.length ?? 0),
    0,
  );
  stages.push({
    name: STAGE_TAG_LOAD,
    ms: tagLoadMs,
    candidatesIn: surviving.length,
    candidatesOut: taggedCandidates.length,
    meta: {
      tagsLoadedCount: taggedCandidates.length,
      totalTagRows: totalTagRowsLoaded,
    },
  });

  // --- Stage 3: registry-dispatched rerank. ---------------------------
  const stage3Out = rerank(
    {
      candidates: taggedCandidates,
      queryAttributes,
      profile,
    },
    mode,
  );
  stages.push(stage3Out.contribution);

  // --- Stage 4: merchant signals. -------------------------------------
  const stage4Out = stage4MerchantSignals(stage3Out.candidates);
  stages.push(stage4Out.contribution);

  // --- Stage 5: diversity (MMR + soft quotas + fallback). -------------
  const targetN = clampLimit(input.limit);
  const stage5Out = stage5Diversity(stage4Out.candidates, targetN);
  stages.push(stage5Out.contribution);

  // --- Stage 6: output (finalScore + whyTrace). -----------------------
  const stage6Out = stage6Output(stage5Out.candidates, shopMeta);
  stages.push(stage6Out.contribution);

  const products: ProductCard[] = stage6Out.candidates.map((c) =>
    formatProductCard(c, shopMeta),
  );

  // topDistance mirrors Stage 2's reading. Empty candidate set after
  // Stage 5 still produces a valid PipelineOutput shape — but Stage 2
  // ran (since Stage 1 was non-empty), so topDistance carries Stage 2's
  // value regardless of whether anything survived diversity selection.
  const stage2Meta = stage2Out.contribution.meta as
    | { topDistance: number | null }
    | undefined;
  const topDistance = stage2Meta?.topDistance ?? null;

  const totalMs = Date.now() - wallStartMs;
  const trace: Trace = {
    version: PIPELINE_VERSION,
    intent: input.intent,
    stages,
    totalMs,
  };

  return {
    products,
    trace,
    topDistance,
    totalMs,
  };
}

// --- helpers --------------------------------------------------------

function buildEmptyOutput(args: {
  intent: string;
  stages: StageContribution[];
  wallStartMs: number;
}): PipelineOutput {
  const totalMs = Date.now() - args.wallStartMs;
  return {
    products: [],
    trace: {
      version: PIPELINE_VERSION,
      intent: args.intent,
      stages: args.stages,
      totalMs,
    },
    topDistance: null,
    totalMs,
  };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || limit === null) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(HARD_LIMIT, Math.floor(limit)));
}

function clampPoolSize(size: number | undefined): number {
  if (size === undefined || size === null) return DEFAULT_CANDIDATE_POOL;
  return Math.max(1, Math.min(MAX_CANDIDATE_POOL, Math.floor(size)));
}

async function loadAndAttachTags(
  deps: PipelineDeps,
  candidates: CandidateProduct[],
): Promise<CandidateProduct[]> {
  if (candidates.length === 0) return [];
  const ids = candidates.map((c) => c.id);
  const rows = await deps.prisma.productTag.findMany({
    where: {
      productId: { in: ids },
      status: "APPROVED",
    },
    select: { productId: true, axis: true, value: true, status: true },
  });
  const byProduct = new Map<string, Array<{ axis: string; value: string; status: string }>>();
  for (const r of rows) {
    let bucket = byProduct.get(r.productId);
    if (!bucket) {
      bucket = [];
      byProduct.set(r.productId, bucket);
    }
    bucket.push({ axis: r.axis, value: r.value, status: r.status });
  }
  return candidates.map((c) => ({
    ...c,
    tags: byProduct.get(c.id) ?? [],
  }));
}

// CustomerProfile snapshot loader. In 3.1 the dev shop has zero
// CustomerProfileAttribute rows (PR-D D.3 verifier confirmed), so this
// path is exercised only by tests that explicitly set profileId. The
// mapping below covers the four CustomerProfileSnapshot fields the
// brief defines. New attribute keys are additive — the projection
// silently ignores keys it doesn't know.
async function loadProfileSnapshot(
  deps: PipelineDeps,
  profileId: string | null,
): Promise<CustomerProfileSnapshot | null> {
  if (!profileId) return null;
  const attributes = await deps.prisma.customerProfileAttribute.findMany({
    where: { profileId },
    select: { key: true, value: true },
  });
  if (attributes.length === 0) return null;
  const snapshot: CustomerProfileSnapshot = {};
  for (const a of attributes) {
    if (a.key === "bodyType") snapshot.bodyType = a.value;
    else if (a.key === "fitPreference") snapshot.fitPreference = a.value;
    else if (a.key === "preferredColors") {
      snapshot.preferredColors = parseListValue(a.value);
    } else if (a.key === "preferredOccasions") {
      snapshot.preferredOccasions = parseListValue(a.value);
    }
  }
  return snapshot;
}

function parseListValue(raw: string): string[] {
  // CustomerProfileAttribute values are stored as strings; list-shaped
  // values are JSON arrays. Defensive: a non-JSON value is treated as a
  // single-item list rather than throwing — keeps the projector robust
  // to historical writes from earlier phases.
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((v) => typeof v === "string");
      }
    } catch {
      // fall through
    }
  }
  return [trimmed];
}

export const __PIPELINE_INTERNALS_FOR_TEST = {
  PIPELINE_VERSION,
  STAGE_QUERY_EXTRACTION,
  STAGE_TAG_LOAD,
};
