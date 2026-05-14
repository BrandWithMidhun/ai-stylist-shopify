# Artifact 13 — fixture-by-fixture ranking-gap inventory

**Probe:** `.pr-3-1-8-planning-artifacts/_probe-fixture-inventory.ts`
**Output:** `.pr-3-1-8-planning-artifacts/_fixture-inventory.json`
**Captured:** 2026-05-14 against current main `7a565aa`, dev shop `ai-fashion-store.myshopify.com`.

## Methodology

For each of the 12 eval fixtures, the probe ran Stages 1-5 of the v2 pipeline and recorded:
- `stage1Count`: Stage 1 candidate count (capped at Stage 1's `CANDIDATE_LIMIT=1000`).
- `stage1SatisfyingCount`: how many Stage 1 candidates have ALL `expectedTagFilters` axes satisfied with APPROVED tags.
- `stage2SatisfyingCount`: how many of those satisfying candidates survive Stage 2's `candidatePoolSize=50` narrowing.
- `stage5SatisfyingCount`: how many of the top-6 satisfy the fixture's expected filters.
- `verdict`: binding-constraint location.

## Verdict legend

- **OK** — top-6 fully satisfies (≥3 satisfying cards). Fixture PASSes or scores high enough to PASS bucket.
- **PARTIAL_RECOVERY_POSSIBLE** — top-6 has 1-2 satisfying cards. Score = 1/6 ≈ 0.167, FAIL bucket (PARTIAL_THRESHOLD=0.50 means need ≥3 in top-6).
- **STAGE_5_SELECTION_MISSES_SATISFYING** — Stage 5's selection skipped satisfying candidates. (No fixture hits this verdict in the inventory; left in for completeness.)
- **STAGE_2_NARROWING_DROPS_SATISFYING** — Stage 1 pool has satisfying candidates; Stage 2's top-50 cap drops them all. The "ranking gap" pattern.
- **NO_SATISFYING_IN_CATALOG_POOL** — Stage 1 pool has zero candidates satisfying the expected filters. Catalog data-quality gap (the secondary-axis sparsity problem).
- **EMPTY_STAGE_1** — Stage 1 returns zero candidates. Vocabulary-coverage gap (or merchandise-absence on this shop).

## Per-fixture inventory

| Fixture | Verdict | stage1 | stage1Sat | stage2Sat | top6Sat | Score (post-mech.4) |
|---|---|---:|---:|---:|---:|---:|
| fashion-casual-office-shirts | OK | 26 | 24 | 24 | 6 | 1.0000 (PASS) |
| fashion-festive-kurta-women | EMPTY_STAGE_1 | 0 | 0 | 0 | 0 | 0.0000 (FAIL) |
| **fashion-going-out-outfit** | **STAGE_2_NARROWING_DROPS_SATISFYING** | 1000 | 16 | **0** | 0 | 0.0000 (FAIL) |
| fashion-linen-shirts-white | PARTIAL_RECOVERY_POSSIBLE | 26 | 2 | 2 | 1 | 0.1667 (FAIL) |
| fashion-minimalist-daily-wear | PARTIAL_RECOVERY_POSSIBLE | 1000 | 37 | 1 | 1 | 0.1667 (FAIL) |
| fashion-oos-stress-1 | PARTIAL_RECOVERY_POSSIBLE | 26 | 2 | 2 | 1 | 0.1667 (FAIL) |
| fashion-oos-stress-2 | EMPTY_STAGE_1 | 0 | 0 | 0 | 0 | 0.0000 (FAIL) |
| **fashion-oversized-fit-kurta** | **STAGE_2_NARROWING_DROPS_SATISFYING** | 202 | 1 | **0** | 0 | 0.0000 (FAIL) |
| fashion-show-jackets | OK | 5 | 5 | 5 | 5 | 1.0000 (PASS) |
| fashion-show-trousers | OK | 8 | 8 | 8 | 6 | 1.0000 (PASS) |
| fashion-summer-shorts-size-m | NO_SATISFYING_IN_CATALOG_POOL | 53 | 0 | 0 | 0 | 0.0000 (FAIL) |
| **fashion-wedding-reception** | **STAGE_2_NARROWING_DROPS_SATISFYING** | 1000 | 15 | **0** | 0 | 0.0000 (FAIL) |

## Pattern identification — the architectural finding is broader than the kurta-fixture instance

The HANDOFF amendment named the architectural finding **ranking-vs-tag-completeness gap**, identifying Stage 3 rerank and Stage 5 diversity quotas as the candidate fix sites (fixes a, b). The probe shows the actual gap is upstream of Stage 3 — it's **Stage 2 semantic-similarity narrowing**.

Three fixtures hit `STAGE_2_NARROWING_DROPS_SATISFYING`:

1. **fashion-oversized-fit-kurta** — Stage 1 has 202 candidates, 1 satisfies (the 1 fit=relaxed kurta product). Stage 2's top-50 by similarity drops it.
2. **fashion-going-out-outfit** — Stage 1 has 1000 candidates (hits the `CANDIDATE_LIMIT=1000` cap), 16 satisfy. Stage 2's top-50 drops ALL 16.
3. **fashion-wedding-reception** — Stage 1 has 1000 candidates (also at the cap), 15 satisfy. Stage 2's top-50 drops ALL 15.

The pattern: when Stage 1's pool is much larger than Stage 2's candidatePool=50, semantic similarity ranks tag-complete candidates lower than tag-incomplete-but-semantically-similar candidates. The tag-complete candidates fall below position 50 and are filtered before Stage 3/5 ever sees them.

The kurta fixture is the most dramatic case (1 satisfying product, dropped). The going-out and wedding-reception fixtures are the same pattern at scale (15-16 satisfying products, all dropped).

Two fixtures hit `PARTIAL_RECOVERY_POSSIBLE`:

4. **fashion-linen-shirts-white** — Stage 1 has 26, 2 satisfy, 2 survive Stage 2, 1 makes top-6. The 1/6 result is FAIL bucket but actually has a partial signal.
5. **fashion-oos-stress-1** — Same shape as linen-shirts-white (this fixture's intent "white linen shirt for daily wear" overlaps significantly with the linen-shirts intent).

These two are NOT bottlenecked at Stage 2; they're bottlenecked at top-6 selection where Stage 5's diversity quotas + the 2 satisfying candidates being similar (jaccard-close) result in the MMR cap dropping one of them.

One fixture hits `PARTIAL_RECOVERY_POSSIBLE` via the Stage 2 narrowing path:

6. **fashion-minimalist-daily-wear** — Stage 1 has 1000 (at cap), 37 satisfy, only 1 survives Stage 2, 1 makes top-6. This is the same pattern as the three STAGE_2_NARROWING fixtures but with one satisfying card surviving instead of zero.

## How much would each fix help?

### Fix (a) — Stage 3 rerank tag-overlap signal

**Cannot help the three STAGE_2_NARROWING fixtures.** Stage 3 operates downstream of Stage 2; if the satisfying candidates aren't in Stage 2's top-50 output, no rerank can recover them.

**Marginal help possible for the two PARTIAL_RECOVERY fixtures (linen-shirts-white, oos-stress-1).** Both have 2 satisfying candidates in Stage 5's input but only 1 makes top-6. Stage 3 doesn't change Stage 5's selection ORDER (Stage 5 iterates in similarity order; rerankBoosts feed Stage 6 finalScore only — see artifact 09 and 10 annotations). So fix (a) wouldn't actually move the linen-shirts second satisfying candidate into top-6 either.

**Net eval impact prediction: ~0.** Fix (a) helps no fixture per architectural reading.

### Fix (b) — Stage 5 axis-coverage quota

**Cannot help the three STAGE_2_NARROWING fixtures.** Same reason — satisfying candidates aren't in Stage 5's input.

**Could help the two PARTIAL_RECOVERY fixtures.** A per-axis quota forcing Stage 5 to select satisfying candidates from `skipped` before fallback-filling generic-skipped would move both candidates into top-6, giving 2/6 = 0.333. Still below PARTIAL_THRESHOLD=0.50, but a real eval gain.

**Net eval impact prediction: ~0.028 lift** (2 fixtures × (0.333 - 0.167)/12 ≈ 0.028). Lifts aggregateScore from 0.2917 → 0.32 (still FAIL bucket on those fixtures but partial-credit increases).

### Fix (c) — Proportional coverage discipline

**Doesn't recover anything; prevents future regressions.** The kurta fixture's regression IS the validation evidence for (c) — if (c) had been the discipline, mech.4 would not have shipped 200 RULE kurta rows without also tagging fit on those 200 products, and the regression would not have occurred. But (c) alone doesn't roll back the existing damage.

**Net eval impact prediction: 0 immediate.** Long-term: protects against the next mech.4-style coverage expansion. Carries with it Phase 5 portal-UI implications (the portal's catalog-tagging workflow must enforce proportional axes).

### Fix candidates that DO address the bottleneck (Stage 2)

Based on the probe's STAGE_2_NARROWING pattern, the load-bearing fix shapes are upstream of Stage 3:

- **Increase candidatePool from 50 to a larger N** (e.g., 200 or 500). Lets the satisfying tag-complete candidates survive Stage 2 narrowing. Latency cost: Stage 3-5 process more candidates. May regress healthy fixtures by introducing noise into the top-6.
- **Stage 2 tag-completeness boost.** Augment Stage 2's pure-cosine ranking with a tag-completeness term (e.g., rank by `0.7 × similarityScore + 0.3 × tagCompletenessScore`). Surgical change to Stage 2's algorithmic identity.
- **Stage 1 secondary-axis filter** (option d.Y). If query extracts `fit=oversized`, Stage 1 hard-filters to candidates with APPROVED `fit` tag (any value, or matching value). Shrinks pool from 202 → 2 for kurta; restores pre-mech.4 behavior structurally. Tighter than (c) in that it doesn't depend on data discipline — it's enforced in code.

The Step 5 fix (d) shapes investigation explores these.

## Eval-denominator structural note

The `relaxedMatchAtK` scoring function normalizes by `Math.max(1, top.length)` rather than by `K`. When Stage 1 returns ≤6 candidates and Stage 5 returns all of them, the denominator is < 6 and a single satisfying card scores higher than 1/6.

Pre-mech.4 kurta: Stage 1 = 2, Stage 5 returns 2, 1 satisfying → 1/2 = 0.50 (PARTIAL).
Post-mech.4 kurta: Stage 1 = 202, Stage 5 returns 6, even if 1 satisfying made top-6 → 1/6 = 0.167 (FAIL).

This means even a "perfect ranking fix" that recovers the 1 satisfying kurta product to top-6 only lifts the fixture to 0.167 (FAIL bucket). To recover PARTIAL (≥0.50), the catalog needs ≥3 kurta products satisfying `fit IN {oversized, relaxed}`. The catalog currently has 1.

The catalog-data ceiling makes fix (a)/(b) score-impact-bounded by the existing data quality. Fix (c) addresses the upstream cause (insufficient secondary-axis coverage on the new RULE-tagged products). Fix (d.X) shapes that affect Stage 1/2 can recover the kurta fixture only to the data ceiling (0.167 FAIL), not to the pre-mech.4 0.50 PARTIAL.

This is a SECOND load-bearing observation for the planning round: **the pre-mech.4 0.3333 baseline is not architecturally recoverable from any code-side fix.** The 0.3333 came from a small-pool degeneracy (denominator = 2). Restoring the 0.3333 requires either catalog data growth or a scoring-policy change. Neither (a), (b), (c), nor most (d.X) shapes address this.

## Implication for the (a)/(b)/(c)/(d) fork

Based on this probe, the fork resolution should be:

1. **(a) Stage 3 rerank tag-overlap signal** — NOT recommended. Probe evidence shows fix is structurally insufficient (operates downstream of the bottleneck).
2. **(b) Stage 5 axis-coverage quota** — partial recommendation. Helps 2 fixtures by ~0.028 aggregate; doesn't help the 3 STAGE_2_NARROWING fixtures.
3. **(c) Proportional coverage discipline** — strongly recommended as a *policy* fix (not as eval-recovery). The right discipline; would have prevented the kurta regression.
4. **(d) shapes** — investigate Stage 2-affecting alternatives. The Stage 1 secondary-axis filter (d.Y) is structurally promising; the candidatePool cap raise (d.X) is the simplest.

Step 2 (fix (a) simulation) will empirically confirm whether the probe's architectural reading holds in actual eval runs.
