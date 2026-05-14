# Artifact 12 annotation — kurta candidate pool probe findings

**Probe script:** `.pr-3-1-8-planning-artifacts/_probe-kurta-candidates.ts`
**Output:** `.pr-3-1-8-planning-artifacts/12-kurta-candidate-pool.json`
**Auxiliary probe:** `.pr-3-1-8-planning-artifacts/_probe-kurta-fit-detail.ts` (one-shot, output captured below)
**Captured:** 2026-05-14, dev shop `ai-fashion-store.myshopify.com` against current main `7a565aa`.

## Stage 1: 202 candidates

- Total kurta-category candidates: **202** (2 AI + 200 RULE).
- Candidates carrying APPROVED `fit` tag: **2** (both AI-tagged):
  - `cmoeelkam00lvo436eeeh82pm` fit=**regular**
  - `cmoeelkxq00zio436pji1ms7o` fit=**relaxed**

Catalog-wide products with `fit IN {oversized, relaxed}`: **20**. Of those 20, exactly **1** is also a category=kurta product (`cmoeelkxq00zio436pji1ms7o`, fit=relaxed). The fixture's expectedTagFilters requires `category=kurta AND fit IN {oversized, relaxed}`. **Only 1 product in the entire catalog satisfies both criteria.**

## Stage 2: 50-candidate pool by similarity to "oversized fit kurta"

- Pool cap: 50. Stage 2 returned 50 candidates by pgvector cosine ASC.
- Of the 2 fit-tagged candidates, **only 1 survives** Stage 2's top-50: the fit=**regular** product (ranks #24, distance 0.5045).
- **The fit=relaxed product (the ONLY catalog product satisfying both fixture axes) does NOT survive Stage 2 narrowing.** Its similarity to the query "oversized fit kurta" is lower than at least 50 of the 202 kurta candidates' similarities.

This is the load-bearing empirical finding for fix (a) viability.

## Stage 3 + 5: top-6 selected

| Position | similarityDistance | category | fit | rerankBoosts (occasion/fit/color/body_type) |
|---:|---:|---|---|---|
| 1 | 0.4822 | kurta | (none) | 0/0/0/0 |
| 2 | 0.5045 | kurta | **regular** | 0/0/0/0 |
| 3 | 0.4855 | kurta | (none) | 0/0/0/0 |
| 4 | 0.4885 | kurta | (none) | 0/0/0/0 |
| 5 | 0.4892 | kurta | (none) | 0/0/0/0 |
| 6 | 0.4912 | kurta | (none) | 0/0/0/0 |

- All 6 top cards have `category=kurta` APPROVED → satisfies axis 1.
- 0 top cards have `fit IN {oversized, relaxed}` APPROVED → axis 2 unsatisfied.
- relaxedMatchAtK = 0/6 = 0 → fixture FAIL.

Position 2 IS the fit-tagged candidate (fit=regular), but "regular" is NOT in the fixture's expected fit values, so it doesn't satisfy the relaxed match. The rerank boosts on position 2 are 0/0/0/0 because:
- occasion reranker: queryAttributes has no occasion (only `category` and `fit`). overlap=0.
- fit reranker: queryAttributes.fit=["oversized"], candidate fit=["regular"]. matches=false → 0.
- color reranker: queryAttributes has no color_family. → 0.
- body_type reranker: profile=null → 0.

So the rerank boosts contribute nothing to this candidate's position. It survives Stage 5 purely on similarity-order (rank 24 in Stage 2's pool of 50 + Stage 5's quota/MMR dynamics that elevated some lower-rank candidates).

## Reconciliation with mech.4.5 verification analysis

The mech.4.5 verification analysis (line 144) stated: "Of those 2, exactly 1 had `fit` APPROVED, producing relaxedMatchAtK = 1/2 = 0.50."

The probe finds 2 of 2 AI-tagged kurta products have APPROVED `fit` tag. The reconciliation: the mech.4.5 analysis was likely counting "fit in the expected values {oversized, relaxed}", which IS 1 of 2 (the fit=relaxed one). The probe is counting "fit APPROVED at all", which is 2 of 2. Both readings produce the same load-bearing conclusion (only 1 product satisfies both fixture axes).

## Load-bearing finding for fix-candidate viability

**The fit=relaxed kurta product (the ONLY catalog product satisfying both fixture axes) does NOT enter Stage 2's top-50 pool.** Any fix that operates downstream of Stage 2 — including fix (a) Stage 3 rerank tag-overlap and fix (b) Stage 5 axis-coverage quota — CANNOT recover this fixture. The satisfying product is filtered before those stages see it.

The downstream-of-Stage-2 fixes (a) and (b) can affect ranking within Stage 2's top-50 pool, but the pool is missing the one satisfying product. No reranking or quota policy can include a product that isn't present.

The fixes that COULD affect this fixture's outcome:
1. **(c) Proportional coverage discipline:** prevents future mech.4-style coverage expansions without proportional secondary-axis tagging. Doesn't fix the existing regression but prevents the pattern.
2. **(d.X) Stage 2 pool-size cap increase:** raise candidatePool from 50 to N≥220 (covers all 202 kurta candidates). Lets the fit=relaxed product into Stage 5's input pool. STILL requires Stage 5 axis-coverage logic to actually select it from the pool.
3. **(d.Y) Stage 1 secondary-axis filter:** require Stage 1 candidates to have APPROVED tags on the query's extracted secondary axes (i.e., if query extracts fit=oversized, Stage 1 must require APPROVED fit on candidates). Stage 1 would return 2 candidates instead of 202 — restoring pre-mech.4 behavior structurally rather than via data-quality discipline.
4. **(d.Z) Catalog data-quality intervention:** tag more kurta products with fit=oversized/relaxed APPROVED. Data-side work, not code-side. Independent of any code fix; would lift the fixture's ceiling because there'd be more satisfying products to recover.

## Secondary finding — the eval denominator changes when Stage 1 expands

Pre-mech.4: Stage 1 returned 2, Stage 5 returned 2. relaxedMatchAtK = 1/2 = **0.50 PARTIAL**.
Post-mech.4: Stage 1 returns 202, Stage 5 returns 6. Even if BOTH fit-tagged candidates were in top-6, relaxedMatchAtK = 1/6 = **0.167 FAIL** (below PARTIAL_THRESHOLD=0.50).

`relaxedMatchAtK` (in `app/lib/recommendations/v2/eval/scoring.ts:91`) normalizes by `Math.max(1, top.length)`. When Stage 1's pool expands and Stage 5 returns 6 instead of 2, the denominator grows from 2 to 6 — a 3x increase in the divisor. The satisfying-card count is at most 1 (only 1 product satisfies both axes in the catalog). So the ceiling becomes 1/6 = 0.167, locked at FAIL bucket.

**To restore the pre-mech.4 0.50 PARTIAL baseline on this fixture, the catalog must have at least 3 products satisfying both axes (3/6 = 0.50).** Or `relaxedMatchAtK`'s denominator semantics must change (e.g., max with K instead of max with returned-count). That latter change is itself a scoring-policy decision worth surfacing — it would re-anchor every fixture's score.

## Implication for fix (a) simulation

The Step 2 simulation tests fix (a) against the FULL eval suite. The expected outcome based on this probe:
- **kurta fixture: 0 → 0** (regression unfixed; fix (a) can't recover what Stage 2 dropped).
- **Other fixtures: marginal changes possible** if their Stage 5 top-6 contains tag-complete candidates that would benefit from a higher rerank boost.

If the simulation produces no improvement on the kurta fixture, this confirms the architectural reading. If it does improve, my premise check (Stage 5 doesn't consult rerankBoosts) is wrong and the simulation reveals an unanticipated downstream behavior worth investigating.

## Auxiliary probe output (for the record)

From `_probe-kurta-fit-detail.ts`:

```
AI-tagged kurta product IDs: ["cmoeelkam00lvo436eeeh82pm","cmoeelkxq00zio436pji1ms7o"]
AI-tagged kurta fit tags:
  cmoeelkam00lvo436eeeh82pm  fit=regular
  cmoeelkxq00zio436pji1ms7o  fit=relaxed
Catalog-wide products with fit=oversized OR relaxed: 20
Intersection (kurta AI + fit IN {oversized,relaxed}): 1
```
