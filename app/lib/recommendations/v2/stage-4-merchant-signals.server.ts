// PR-3.1-mech.5: Stage 4 of the v2 pipeline — merchant signal injection.
//
// Pure function; no DB call. Reads candidate.recommendationPromoted
// (already loaded by Stage 1's SQL in mech.2) and candidate.salesVelocity30d
// (which does NOT exist as a Product column in 3.1; 3.2 adds it).
// In 3.1, every candidate's velocity is undefined → boost 0.
//
// Boosts (per locked decision D1, D2):
//   - Promoted: 0.2 binary (recommendationPromoted=true → 0.2; else 0).
//   - Velocity: log-scale, capped at 0.3.
//       boost = min(0.3, log10(1 + velocity) / log10(101))
//     velocity=0 → 0; velocity=100 → 0.3; intermediate values smooth.
//     The cap denominator (log10(101)) was chosen so velocity=100
//     hits exactly 0.3. 3.2 may swap this for a per-store percentile
//     normalisation when real velocity data lands.
//
// contribution.meta records (per D3):
//   - promotedCount: count of candidates with recommendationPromoted=true
//   - velocityNullCount: count with velocity undefined OR null OR 0
//     (the no-data state — the metric for "did 3.2 actually start
//     populating salesVelocity30d?")
//   - velocityNonZeroCount: count with velocity > 0 (always 0 in 3.1)
//
// Stage 4 PRESERVES candidate set size — no filtering, no reordering.

import type { CandidateProduct, StageOutput } from "./types";

const STAGE_NAME = "stage-4-merchant-signals";
const PROMOTED_BOOST = 0.2;
const VELOCITY_CAP = 0.3;
// log10(1 + 100) = log10(101); chosen so velocity=100 → boost=0.3.
const VELOCITY_DENOM = Math.log10(101);

function velocityBoost(velocity: number | null | undefined): number {
  if (!velocity || velocity <= 0) return 0;
  const raw = Math.log10(1 + velocity) / VELOCITY_DENOM;
  return Math.min(VELOCITY_CAP, raw);
}

export function stage4MerchantSignals(
  stage3Candidates: CandidateProduct[],
): StageOutput {
  const startMs = Date.now();
  const candidatesIn = stage3Candidates.length;

  let promotedCount = 0;
  let velocityNullCount = 0;
  let velocityNonZeroCount = 0;

  const out: CandidateProduct[] = stage3Candidates.map((c) => {
    const promoted = c.recommendationPromoted ? PROMOTED_BOOST : 0;
    const velocity = velocityBoost(c.salesVelocity30d);
    if (c.recommendationPromoted) promotedCount += 1;
    if (!c.salesVelocity30d || c.salesVelocity30d <= 0) {
      velocityNullCount += 1;
    } else {
      velocityNonZeroCount += 1;
    }
    return {
      ...c,
      merchantSignals: {
        promoted,
        velocity,
      },
    };
  });

  return {
    candidates: out,
    contribution: {
      name: STAGE_NAME,
      ms: Date.now() - startMs,
      candidatesIn,
      candidatesOut: out.length,
      meta: {
        promotedCount,
        velocityNullCount,
        velocityNonZeroCount,
      },
    },
  };
}
