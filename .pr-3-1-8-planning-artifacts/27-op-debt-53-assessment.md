# Artifact 27 — Op debt #53 assessment: Stage 2 candidatePool=50 caps narrowing dilution

## 1. Verbatim re-pull (Thread 3 artifact 20 § 7, candidate op debt #53)

> #53 — Stage 2 candidatePool=50 caps narrowing dilution. When Stage 1's pool size exceeds 50, Stage 2's narrowing can drop tag-complete candidates that don't rank in the top-50 by pure semantic similarity. The 3 fixtures (kurta, going-out, wedding-reception) all hit this bottleneck (1000 → 50 narrowing drops 15-16 satisfying candidates each). Possible mitigations: raise pool size, weight Stage 2 by tag-completeness (d.3), or move the filter upstream (d.2-strict). **Priority: High.** Load-bearing for 3.2 fix design.

## 2. Current empirical state

Probe evidence (Thread 3 artifact 13, fixture inventory):

| Fixture | Stage 1 | Stage 1 satisfying | Stage 2 satisfying (top-50) | Verdict |
|---|---:|---:|---:|---|
| fashion-going-out-outfit | 1000 | 16 | 0 | STAGE_2_NARROWING_DROPS_SATISFYING |
| fashion-oversized-fit-kurta | 202 | 1 | 0 | STAGE_2_NARROWING_DROPS_SATISFYING |
| fashion-wedding-reception | 1000 | 15 | 0 | STAGE_2_NARROWING_DROPS_SATISFYING |
| fashion-minimalist-daily-wear | 1000 | 37 | 1 | PARTIAL_RECOVERY_POSSIBLE (Stage 2 dropped 36 of 37 satisfying) |

The going-out and wedding-reception fixtures hit Stage 1's `CANDIDATE_LIMIT=1000` cap (Stage 1's defensive bound). The kurta fixture is at 202. All four fixtures lose satisfying candidates because Stage 2's pgvector cosine ranks tag-incomplete candidates higher than tag-complete candidates within the broader Stage 1 pool.

**No drift since 3.1.7.** Stage 2's `candidatePoolSize=50` is a constant in `pipeline.server.ts` (`DEFAULT_CANDIDATE_POOL = 50`, `MAX_CANDIDATE_POOL = 100`).

## 3. Scope estimate — what closing this debt requires

The HANDOFF candidate names three mitigations; Thread 3 explored all three under Fix d.X shapes:

- **Raise pool size from 50 to N (e.g., 200, 500, or 1000):** ~5 LOC change in `pipeline.server.ts` constants. Latency cost: Stage 3-5 process more candidates per fixture. Trivial scope; uncertain calibration.
- **Stage 2 tag-completeness weighting (d.3):** ~50-100 LOC across `stage-2-semantic-retrieval.server.ts` + `findSimilarProductsAmongCandidates`. SQL complexity increases (pgvector cosine + JOIN to count APPROVED tags + weighted formula).
- **Stage 1 hard-filter on extracted query axes (d.2-strict):** ~50 LOC in `stage-1-hard-filters.server.ts`. Effectively bypasses Stage 2's narrowing problem by shrinking Stage 1's pool before Stage 2 runs.

d.2-strict is Thread 3's recommended fix (artifact 18 conclusion). It addresses the bottleneck at its upstream source rather than mitigating downstream.

**Scope per option:**
- Pool size raise alone: ~5 LOC + verification. Smallest.
- d.3 weighting: ~80-100 LOC + tests. Medium-large.
- d.2-strict: ~50 LOC + tests + 1 plumbing arg through pipeline. Medium.

## 4. Implementation surface

Recommended path (d.2-strict per Thread 3):
- **`app/lib/recommendations/v2/stage-1-hard-filters.server.ts`** — primary site. Add per-axis predicate generation from extracted queryAttributes.
- **`app/lib/recommendations/v2/pipeline.server.ts`** — pass extracted queryAttributes to Stage 1 (currently Stage 1 only receives intent + shopDomain; queryAttributes is computed in Stage 0 BEFORE Stage 1 but isn't currently passed downstream).
- **Stage 1 unit tests** — 3-5 new tests covering the new predicate behavior.
- **Verification probe** — re-run `_probe-fixture-inventory.ts` post-d.2-strict.
- **Eval rerun** to confirm aggregateScore lift.

Alternative path (pool size raise + d.3):
- More SQL surgery; less surgical. Not recommended per artifact 18.

## 5. Eval movement prediction

Per Thread 3 artifact 18 d.2-strict prediction: **+0.45 aggregate** (0.2917 → ~0.75).

Per-fixture trajectory:
- kurta: 0 → 1.0 (Stage 1 shrinks to the 1 satisfying product)
- going-out-outfit: 0 → 1.0 (16 satisfying; Stage 5 picks 6)
- wedding-reception: 0 → 1.0 (15 satisfying)
- linen-shirts-white: 0.167 → 1.0 (2 satisfying; small denominator)
- minimalist-daily-wear: 0.167 → 1.0 (37 satisfying)
- oos-stress-1: 0.167 → 1.0

This is a step-change recovery. But it comes with empty-Stage-1 risk for real-merchant queries when extractor produces axes the catalog doesn't have APPROVED rows for.

Per Thread 3's recommendation, this risk is best assessed against production traffic post-flip. So #53 closure in 3.2 ships AFTER 3.1.8 flip + traffic measurement.

## 6. Coupling to other debts

- **#52 Stage 5 ignores rerankBoosts:** closely paired in Thread 3's "Stage 2-5 ranking-architecture cluster." d.2-strict (the recommended fix for #53) makes #52 less load-bearing (if Stage 1 already filters, Stage 5's order matters less).
- **#46 size_range AI-tagger reliability:** tight coupling for the shorts-size-m fixture. d.2-strict's effectiveness for size queries requires #46 closure (otherwise d.2-strict empties Stage 1 for size-tagged queries on a catalog with only 3 size_range-tagged products).
- **#54 relaxedMatchAtK denominator:** indirect. The eval recovery prediction for d.2-strict (artifact 18) assumes current `relaxedMatchAtK` semantics. If #54 closure changes the denominator (e.g., divide by K=6 always), the +0.45 prediction changes proportionally.
- **#55 deferred architectural finding:** #53 closure IS the implementation of #55's deferred work.

**Tight coupling to #46 and #52.** The 3.2 catalog-data cluster and ranking-architecture cluster overlap at d.2-strict's design.

## 7. Triage verdict

**(N) next-sub-bundle.**

Reasoning:
- The flip doesn't depend on #53. v1 has no Stage 2 narrowing (it's a flat nearest-neighbor); v2 inherits the bottleneck. The flip moves users from v1's behavior to v2's — neither is better than the other on the specific narrowing-dilution dimension. v2 is structurally richer overall.
- Thread 3 explicitly placed d.2-strict (the #53 fix) in 3.2.
- The fix requires real-merchant-traffic data to safely parameterize (strict vs relaxed; which axes to gate on).

**Why NOT bundle-with-flip (B):**
- Scope is medium (~50 LOC), but the empty-Stage-1 risk is the load-bearing reason to defer. Shipping d.2-strict pre-flip means flying blind on parameterization.

**Why NOT flip-blocking (F):**
- The flip's user-facing event is improved by d.2-strict (better top-K relevance on tag-complete queries) but not blocked by its absence. v2 ships against current Stage 2 narrowing behavior; that behavior is documented and not strictly worse than v1's.

**Recommendation:** carry to 3.2 as the primary fix in the ranking-architecture cluster. Pair sequencing with #46 (so shorts-size-m fixture has size_range coverage before d.2-strict ships). Pair design discussion with #52 (rerank-aware Stage 5) and #55 (the carry-forward architectural finding) for cluster-level coherence.
