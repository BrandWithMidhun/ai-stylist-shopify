// PR-3.1-mech.5: Stage 5 of the v2 pipeline — diversity selection.
//
// Greedy MMR (Maximal Marginal Relevance) with soft category + colour
// quotas and a fallback pass. Per locked decision D4 (R2 of mech.1
// planning round):
//
//   First pass:
//     For each candidate in input order (input is sorted by Stage 4
//     relevance):
//       - Compute MMR penalty = max jaccard(candidate.tags, selected[i].tags)
//         across all already-selected candidates.
//       - Apply soft quotas: skip if selected count for productType >= 2
//         OR selected count for color_family >= 3.
//       - If MMR penalty < threshold (0.6), accept; else skip.
//       - Stop when selected.length === targetN.
//     Track skipped candidates separately, in their original order.
//
//   Second pass (fallback):
//     Only fires if selected.length < targetN. Append from skipped
//     candidates (preserving Stage 4 relevance order) until selected
//     hits targetN OR skipped is exhausted. trace meta records
//     diversityQuotaFallback=true. The fallback-filled candidate's
//     diversityPenalty retains the value that would have caused
//     rejection in the first pass — traces stay honest about why
//     they were originally skipped.
//
// OOS substitute path is structurally absent in 3.1 (per locked
// decision D6). Stage 1's EXISTS pre-filter handles steady state; the
// rare mid-pipeline-flip case (variant availability changes between
// Stage 1 and Stage 5) is unaddressed. Documented as op debt at 3.1
// close. mech.6 orchestrator may add a fresh availableForSale check
// on top-N candidates before Stage 5 ranks; if implemented there,
// Stage 5 stays as-is.

import type { CandidateProduct, StageOutput } from "./types";

const STAGE_NAME = "stage-5-diversity";

const CATEGORY_MAX = 2;
const COLOR_FAMILY_MAX = 3;
const MMR_THRESHOLD = 0.6;
const HARD_LIMIT = 12;

function approvedValuesFor(
  candidate: CandidateProduct,
  axis: string,
): string[] {
  if (!candidate.tags) return [];
  const out: string[] = [];
  for (const t of candidate.tags) {
    if (t.status === "APPROVED" && t.axis === axis) out.push(t.value);
  }
  return out;
}

function tagSetKey(tags: NonNullable<CandidateProduct["tags"]>): Set<string> {
  const set = new Set<string>();
  for (const t of tags) {
    if (t.status === "APPROVED") set.add(`${t.axis}:${t.value}`);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection += 1;
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function categoryFor(candidate: CandidateProduct): string | null {
  const cats = approvedValuesFor(candidate, "category");
  return cats[0] ?? null;
}

function colorFamilyFor(candidate: CandidateProduct): string | null {
  const colors = approvedValuesFor(candidate, "color_family");
  return colors[0] ?? null;
}

export function stage5Diversity(
  stage4Candidates: CandidateProduct[],
  targetN: number,
): StageOutput {
  const startMs = Date.now();
  const candidatesIn = stage4Candidates.length;
  const cap = Math.max(0, Math.min(HARD_LIMIT, targetN));

  if (candidatesIn === 0 || cap === 0) {
    return {
      candidates: [],
      contribution: {
        name: STAGE_NAME,
        ms: Date.now() - startMs,
        candidatesIn,
        candidatesOut: 0,
        meta: {
          algorithm: "greedy-mmr-soft-quotas",
          quotas: {
            categoryMax: CATEGORY_MAX,
            colorFamilyMax: COLOR_FAMILY_MAX,
            mmrThreshold: MMR_THRESHOLD,
          },
          diversityQuotaFallback: false,
          skippedCount: 0,
          fallbackFilledCount: 0,
        },
      },
    };
  }

  // Pre-compute tag sets to avoid rebuilding inside the inner loop.
  const tagSets = new Map<string, Set<string>>();
  for (const c of stage4Candidates) {
    tagSets.set(c.id, c.tags ? tagSetKey(c.tags) : new Set());
  }

  type Skipped = { candidate: CandidateProduct; rejectionPenalty: number };
  const selected: CandidateProduct[] = [];
  const skipped: Skipped[] = [];
  const categoryCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();

  for (const candidate of stage4Candidates) {
    if (selected.length >= cap) break;

    const candTagSet = tagSets.get(candidate.id) ?? new Set<string>();
    let penalty = 0;
    for (const sel of selected) {
      const selSet = tagSets.get(sel.id) ?? new Set<string>();
      const j = jaccard(candTagSet, selSet);
      if (j > penalty) penalty = j;
    }

    const category = categoryFor(candidate);
    const colorFamily = colorFamilyFor(candidate);
    const categoryCount = category ? categoryCounts.get(category) ?? 0 : 0;
    const colorCount = colorFamily ? colorCounts.get(colorFamily) ?? 0 : 0;

    const quotaViolated =
      (category !== null && categoryCount >= CATEGORY_MAX) ||
      (colorFamily !== null && colorCount >= COLOR_FAMILY_MAX);
    const mmrViolated = penalty >= MMR_THRESHOLD;

    if (quotaViolated || mmrViolated) {
      skipped.push({ candidate, rejectionPenalty: penalty });
      continue;
    }

    selected.push({ ...candidate, diversityPenalty: penalty });
    if (category) {
      categoryCounts.set(category, categoryCount + 1);
    }
    if (colorFamily) {
      colorCounts.set(colorFamily, colorCount + 1);
    }
  }

  // Fallback: fill remaining slots from skipped candidates, preserving
  // Stage 4 relevance order (which is iteration order = skipped's
  // append order). Each fallback-filled candidate's diversityPenalty
  // retains the would-have-rejection value so the trace remains
  // honest about why it was originally skipped (per D4.2).
  let fallbackFilled = 0;
  if (selected.length < cap) {
    for (const s of skipped) {
      if (selected.length >= cap) break;
      selected.push({
        ...s.candidate,
        diversityPenalty: s.rejectionPenalty,
      });
      fallbackFilled += 1;
    }
  }

  const diversityQuotaFallback = fallbackFilled > 0;

  // TODO mech.6 or future: OOS substitute path. Stage 1's EXISTS
  // pre-filter handles steady-state OOS exclusion; the mid-pipeline-
  // flip case (a candidate's only available variant flips out of stock
  // between Stage 1 query and Stage 5 selection) is rare but real.
  // Implementation belongs in the orchestrator (mech.6) where a fresh
  // ProductVariant.availableForSale check on top-N is cheap and
  // Prisma-shaped. If implemented there, Stage 5 stays as-is — every
  // candidate's flaggedOos remains undefined in 3.1.

  return {
    candidates: selected,
    contribution: {
      name: STAGE_NAME,
      ms: Date.now() - startMs,
      candidatesIn,
      candidatesOut: selected.length,
      meta: {
        algorithm: "greedy-mmr-soft-quotas",
        quotas: {
          categoryMax: CATEGORY_MAX,
          colorFamilyMax: COLOR_FAMILY_MAX,
          mmrThreshold: MMR_THRESHOLD,
        },
        diversityQuotaFallback,
        skippedCount: skipped.length,
        fallbackFilledCount: fallbackFilled,
      },
    },
  };
}
