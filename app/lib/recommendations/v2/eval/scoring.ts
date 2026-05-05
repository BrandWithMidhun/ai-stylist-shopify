// PR-3.1-mech.1: pure scoring functions for the v2 pipeline eval harness.
//
// No DB access, no I/O — these are the metric primitives the eval runner
// composes. Bytes-on-disk choice: keep this file pure so unit tests can
// run in isolation and so the same metric definitions can be reused by
// future inline-CI checks or a Phase 4 portal eval surface without
// pulling Prisma into the import graph.
//
// Score weighting per the locked plan §5b:
//   score = 0.7 × relaxedMatchAtK + 0.3 × precisionAtK   when expectedHandles non-empty
//   score = relaxedMatchAtK                              otherwise (handles-empty fallback)
//
// PASS / PARTIAL / FAIL thresholds at 0.75 / 0.50 per the locked plan §5b.

export type EvalStatus = "PASS" | "PARTIAL" | "FAIL";

export type ProductWithTags = {
  handle: string;
  tags: Array<{ axis: string; value: string }>;
};

export const PASS_THRESHOLD = 0.75;
export const PARTIAL_THRESHOLD = 0.5;
export const RELAXED_WEIGHT = 0.7;
export const STRICT_WEIGHT = 0.3;

// precisionAtK: of the actual top-K handles, how many appear in the
// expected set. Normalised against min(|actual|, |expected|) so a
// run that returns all 3 expected handles inside its top-6 still
// scores 1.0 — penalising the pipeline for not knowing which 3 of
// 6 the merchant secretly preferred would be a brittleness trap.
export function precisionAtK(actual: string[], expected: string[]): number {
  if (actual.length === 0 || expected.length === 0) return 0;
  const expectedSet = new Set(expected);
  let matches = 0;
  for (const handle of actual) {
    if (expectedSet.has(handle)) matches += 1;
  }
  return matches / Math.min(actual.length, expected.length);
}

// relaxedMatchAtK: of the top-K returned products, how many satisfy
// every axis filter. A product satisfies a filter on axis A if its
// APPROVED tags include at least one value from the allowed list for
// axis A. Empty filters → 0 (caller is responsible for not invoking
// relaxed match when no filters exist; the runner falls back to
// score=0 in that case rather than dividing by zero).
export function relaxedMatchAtK(
  actualWithTags: ProductWithTags[],
  expectedTagFilters: Record<string, string[]>,
  k: number,
): number {
  if (actualWithTags.length === 0) return 0;
  const filterAxes = Object.keys(expectedTagFilters);
  if (filterAxes.length === 0) return 0;

  const top = actualWithTags.slice(0, k);
  let satisfying = 0;
  for (const product of top) {
    const tagsByAxis = new Map<string, Set<string>>();
    for (const tag of product.tags) {
      let bucket = tagsByAxis.get(tag.axis);
      if (!bucket) {
        bucket = new Set();
        tagsByAxis.set(tag.axis, bucket);
      }
      bucket.add(tag.value);
    }
    let satisfies = true;
    for (const axis of filterAxes) {
      const allowedValues = expectedTagFilters[axis] ?? [];
      const productValues = tagsByAxis.get(axis);
      if (!productValues) {
        satisfies = false;
        break;
      }
      let anyMatch = false;
      for (const v of allowedValues) {
        if (productValues.has(v)) {
          anyMatch = true;
          break;
        }
      }
      if (!anyMatch) {
        satisfies = false;
        break;
      }
    }
    if (satisfies) satisfying += 1;
  }
  return satisfying / Math.max(1, top.length);
}

// combinedScore: weighted hybrid per plan §5b.
//   - When expectedHandles is populated: 0.7 relaxed + 0.3 precision.
//   - When empty (mech.1 stub fixtures, or future fixtures Midhun
//     deliberately leaves un-handle'd): 1.0 × relaxed.
// This is the shape that lets stub fixtures still produce a meaningful
// score the moment expectedTagFilters are filled in, without forcing
// hand-curation of expected handles before mech.6.
export function combinedScore(
  precision: number,
  relaxed: number,
  hasExpectedHandles: boolean,
): number {
  if (hasExpectedHandles) {
    return RELAXED_WEIGHT * relaxed + STRICT_WEIGHT * precision;
  }
  return relaxed;
}

export function classifyStatus(score: number): EvalStatus {
  if (score >= PASS_THRESHOLD) return "PASS";
  if (score >= PARTIAL_THRESHOLD) return "PARTIAL";
  return "FAIL";
}
