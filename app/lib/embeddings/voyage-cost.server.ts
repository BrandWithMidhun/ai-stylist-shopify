// PR-3.1-mech.6: Voyage-3 cost helper.
//
// Single source of truth for the per-token rate so a future Voyage price
// change is a one-line edit. All other Voyage call sites (RE_EMBED worker
// handler, future bulk re-embed pass for sub-bundle 3.1.5) compute cost
// through this module, not by inlining the rate.
//
// Rate source: voyageai.com pricing page for voyage-3, verified 2026-05-05.
// $0.06 per 1M tokens, applied symmetrically to query and document calls.
// (voyage-3 charges per input token; there is no separate output token
// price, unlike Anthropic's per-input/per-output split priced in
// tagging-cost.server.ts.)
//
// Cost is in microdollars (1 USD = 1_000_000 micros), matching the
// TaggingJob.costUsdMicros column convention. We round to the nearest
// integer micro since BigInt accumulation downstream cannot accept
// fractional micros and per-call rounding error is bounded by ½ micro.

export const VOYAGE_3_USD_PER_MTOK = 0.06;

export type VoyageCost = {
  tokens: number;
  costMicros: number;
};

export function computeVoyageCost(tokens: number): VoyageCost {
  const safeTokens = Math.max(0, Math.trunc(tokens));
  // tokens / 1M * $0.06 * 1M micros/USD simplifies to tokens * 0.06.
  const costMicros = Math.round(safeTokens * VOYAGE_3_USD_PER_MTOK);
  return { tokens: safeTokens, costMicros };
}
