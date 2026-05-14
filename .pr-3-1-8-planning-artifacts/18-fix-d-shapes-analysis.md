# Artifact 18 — Fix (d) shapes analysis

The Step 5 spec enumerated three alternative shapes worth at-least-cursory investigation. The probe evidence (artifact 12, 13) surfaced a fourth shape that emerged from the data. All four are covered here. The 3.1.7-Thread-3 Option-C-folded precedent: don't manufacture a (d) for novelty's sake, but don't suppress one if evidence supports it.

## d.1 — Hybrid (a) + (c)

**Rationale:** Stage 3 tag-overlap signal handles existing tag-asymmetry; proportional coverage discipline prevents future asymmetry. Best-of-both-worlds candidate.

**Code surface implication:** sum of (a) and (c). ~25 LOC for the tag_overlap reranker; 0 LOC for (c-future) discipline. ~30 LOC for (c-γ) script hook if shipped.

**Predicted eval impact:** identical to fix (a) alone — i.e., 0. The (c) component prevents future regressions but doesn't recover the kurta. The (a) component is a null result per artifact 14/15.

**Structural cleanliness:** lower than (a) alone because it bundles a process change with a code change. Mixed-concern PR. Could be split: (c) as a planning-round-close commit, (a) as a separate eval-experiment commit.

**Recommendation:** **Not the right shape.** The (a) component is empirically null. Bundling (a) with (c) doesn't improve (a)'s value; it just hides (a)'s null result under the (c) wrapper.

If (a) were re-shaped to be effective (e.g., paired with Stage 5 re-sort-by-Stage-4-score), then (a-effective) + (c) becomes a stronger candidate. See d.4 below.

## d.2 — Stage 1 augmentation, "minimum tag-completeness threshold"

**Rationale:** Add a Stage 1 predicate that excludes candidates missing enough secondary-axis tags from the pool entirely. Different surface from (a) or (b); avoids dilution at the source.

**Code surface implication:** ~50 LOC in `app/lib/recommendations/v2/stage-1-hard-filters.server.ts`. Add a per-query optional predicate: "if extracted queryAttributes includes a non-category axis (fit, color, occasion, season, style_type, etc.), candidates must have APPROVED `<axis>` (any value)." Plus 3-5 new unit tests for the new predicate.

Two parameterizations:
- **d.2-strict:** require APPROVED axis matching one of the extracted values (e.g., fit=oversized → require APPROVED fit IN {oversized, relaxed} per the expanded synonym set).
- **d.2-relaxed:** require APPROVED axis ANY value (e.g., fit=oversized → require APPROVED fit IN any-value).

**Predicted eval impact:**

For the kurta fixture:
- d.2-strict: Stage 1 returns only the 1 catalog product with category=kurta AND fit IN {oversized,relaxed} = 1 candidate. Stage 5 returns 1 card; 1/1 = 1.0 PASS bucket. **Fixture goes 0 → 1.0**.
- d.2-relaxed: Stage 1 returns the 2 AI-tagged kurta products (both have fit APPROVED) = 2 candidates. Stage 5 returns 2 cards; if the satisfying one is selected = 1/2 = 0.50 PARTIAL. **Fixture goes 0 → 0.50**.

For the going-out-outfit fixture:
- Extracted queryAttributes: occasion=["event"]. d.2-strict requires APPROVED occasion=event. Stage 1 returns the 16 satisfying products (which by definition have APPROVED occasion=event). Stage 5 returns 6 cards from 16; 6/6 = 1.0 PASS. **Fixture goes 0 → 1.0** if all 6 selected satisfy (highly likely; remaining 10 also satisfy).

For wedding-reception fixture:
- Similar logic. 15 satisfying products; Stage 5 returns 6; expect 6/6 = 1.0 PASS. **Fixture goes 0 → 1.0**.

For the PARTIAL_RECOVERY fixtures (linen-shirts-white, oos-stress-1, minimalist-daily-wear):
- d.2 may shrink their Stage 1 pools to the satisfying subset. linen-shirts-white: 2 satisfying → top-K = 2 → 2/2 = 1.0 PASS. Score goes 0.167 → 1.0.
- oos-stress-1 same as linen-shirts.
- minimalist-daily-wear: 37 satisfying → top-K = 6 → 6/6 = 1.0 PASS (assuming Stage 2 keeps them all). Score 0.167 → 1.0.

For the healthy fixtures (casual-office-shirts, show-jackets, show-trousers): all already at 1.0 PASS; d.2 doesn't change the outcome.

For the EMPTY_STAGE_1 fixtures (kurta-women, oos-stress-2): no change (gender / saree gap, not relevant to d.2).

For NO_SATISFYING_IN_CATALOG_POOL (summer-shorts-size-m): Stage 1 returns 0 under d.2 (size_range coverage is 3 distinct products; the 53 shorts don't overlap). No change from baseline.

**Aggregate eval prediction for d.2-strict:**
- kurta: 0 → 1.0
- going-out-outfit: 0 → 1.0
- linen-shirts-white: 0.167 → 1.0
- minimalist-daily-wear: 0.167 → 1.0
- oos-stress-1: 0.167 → 1.0
- wedding-reception: 0 → 1.0
- 6 fixtures moved, delta = (1.0 - 0.167)×3 + (1.0 - 0)×3 = 2.5 + 3 = 5.5; divided by 12 = +0.458
- aggregateScore: 0.2917 → **~0.75**

**This would be a step-change from 0.2917 R3.0 to ~0.75 R3.1 territory.**

**Risks:**

1. **Shrinks the candidate pool, may starve fixtures that depended on broad Stage 1 retrieval.** If extracted queryAttributes is over-eager (e.g., the query "show me something" extracts no axes; safe. But the query "white linen shirt" extracts category=shirt, color_family=white, material=linen — d.2-strict requires APPROVED on all three. If no product has all three APPROVED... well that's the satisfying subset by definition. Same outcome as today's eval.)
2. **Behavior on real-merchant queries.** When a customer types "comfy shirt for work," the extractor produces occasion=work + fit=relaxed (synonyms). d.2-strict requires APPROVED occasion=work AND APPROVED fit IN {relaxed}. If only 5 products satisfy both APPROVED, the customer sees only those 5. This is GOOD for relevance but may produce thin result sets.
3. **Empty Stage 1 risk.** For exotic queries (e.g., "pink linen kurta in size XL"), d.2-strict might return 0 candidates. Today, Stage 1 returns kurta candidates with imperfect secondary-axis coverage; user sees something. Under d.2-strict, user sees nothing. The chat agent then says "no results found" or falls back, which may be worse UX than imperfect results.
4. **Vocabulary fragility.** d.2-strict's correctness depends on the extractor matching the query's stated axes. The current extractor has 14 direct-match axes + 31 synonyms. Real-merchant queries may include un-extracted axes ("kurta with thread-work embroidery" — the embroidery isn't extracted, so d.2 doesn't gate on it). Strict gating on extracted axes is therefore correct-but-narrow; expanding the extractor expands d.2's gating surface.

**Architectural cleanliness:** Stage 1 is already the hard-filter stage. d.2 fits naturally — it's just "hard filter on more axes when the query reveals them." Symmetric with the existing `category` hard filter. The pattern generalizes: every query-extracted axis becomes a Stage 1 hard predicate. Mech.5 D6 had a similar shape (Stage 1 EXISTS pre-filter); the same hard-filter idiom.

**Reversibility:** moderate. The new predicate is gated on extractor output; removing it returns Stage 1 to today's behavior. Stage 1 unit tests need updates.

**Recommendation:** **Strong candidate for the recommended fix.** Largest eval recovery. Aligns with Stage 1's existing identity. Risks are manageable (empty-result fallback can be a soft predicate: d.2-relaxed instead of d.2-strict on first pass; d.2-strict has the largest eval impact at the cost of UX risk for thin result sets). Best parameterization to be decided at mech-prompt time.

## d.3 — Stage 2 weighting, tag-completeness as semantic-similarity boost

**Rationale:** Weight semantic similarity by tag-completeness during retrieval. Different surface from Stage 3 rerank. Puts the tag-completeness signal upstream of Stage 2 narrowing.

**Code surface implication:** ~50-100 LOC across `app/lib/recommendations/v2/stage-2-semantic-retrieval.server.ts` + `findSimilarProductsAmongCandidates`. The pgvector SQL query becomes `ORDER BY (cosine_distance × (1 - tag_completeness_score))` or similar weighted formula. The tag_completeness_score must be computed in SQL (joining ProductTag, counting APPROVED matches against extracted queryAttributes). Significantly more complex than the current pure-cosine query.

**Predicted eval impact:**

The tag-completeness boost reorders Stage 2's top-50. For the kurta fixture, the fit=relaxed candidate currently at similarity rank > 50 would move up. Quantifying exactly how much depends on the weight; a 30% boost on tag-completeness might be enough to lift the fit=relaxed candidate into top-50.

- If fit=relaxed enters top-50 → Stage 5 might select it. If selected → 1/6 = 0.167 (FAIL bucket, but recovery from 0).
- Same logic for going-out-outfit and wedding-reception fixtures: tag-complete candidates move up Stage 2 ranking; some make top-50; Stage 5 selects.
- For PARTIAL_RECOVERY fixtures: marginal — they're already not Stage-2-bottlenecked.

**Aggregate eval prediction:** +0.05 to +0.10 (3 fixtures recover from 0 to 0.167; possibly higher for going-out and wedding-reception if multiple tag-complete candidates surface).

Smaller than d.2-strict but with less data-quality dependency.

**Risks:**

1. **Tag-completeness becomes a hidden Stage-2 signal that's hard to disentangle from semantic similarity itself.** Future debugging of "why did this product rank lower than expected" requires reasoning about both semantic distance AND tag-completeness, where today the answer is purely semantic distance.
2. **SQL complexity.** The pgvector cosine query is already non-trivial. Adding a JOIN to count APPROVED tags + a weighted formula in ORDER BY pushes the query toward "complex enough that a future maintainer fears editing it."
3. **Cold-start problem.** Newly-onboarded shops with 0% APPROVED tags get zero tag-completeness signal. Stage 2 falls back to pure cosine. The pipeline behavior is therefore not portable across the shop-lifecycle: early shops behave one way, mature shops another. Operational complexity.
4. **Stage 3 rerankers become redundant.** If Stage 2 already weights tag-completeness, Stage 3's per-axis rerankers (occasion, fit, color) become double-counting. Pipeline simplicity argues for either Stage-2-weighting OR Stage-3-reranking, not both. Implies a coupled refactor.

**Architectural cleanliness:** lower than d.2. Conflates two concerns (semantic similarity, tag completeness) in a single stage. Stage 3's existing pattern was the cleaner place for tag-overlap signals — but Stage 3 doesn't affect Stage 5 selection (the artifact 15 finding). Putting it in Stage 2 fixes the position-in-pipeline problem but creates the conflated-concerns problem.

**Reversibility:** lower than d.2. The Stage 2 SQL becomes hairier; rolling back means rewriting the query.

**Recommendation:** **Not the primary candidate.** d.2 dominates d.3 on every dimension except "doesn't require accurate query extraction." If extractor quality becomes a Phase-5+ concern, d.3 is the fallback. For 3.1.8, d.2 is cleaner.

## d.4 — Stage 5 rerank-aware iteration order (emerged from probe evidence)

**Rationale:** This shape emerged from the artifact 10 + 15 finding that Stage 5 iterates in Stage 2's similarity order, ignoring Stage 3's rerankBoosts. If Stage 5 re-sorts its input by Stage 4 score (`similarityScore + rerankBoostSum + merchantBoost`) before iterating, then Stage 3 rerank work (existing rerankers + a future tag_overlap reranker) becomes selection-effective rather than display-only.

**Code surface implication:** ~30 LOC in `stage-5-diversity.server.ts`. One new function call at the top of `stage5Diversity` before the main loop:

```typescript
// Sort by Stage 4 score (similarityScore + rerankBoostSum + merchantBoost) DESC.
// rerankBoosts are now selection-effective, not display-only.
const sortedCandidates = [...stage4Candidates].sort((a, b) => {
  const aScore = stageScore(a);
  const bScore = stageScore(b);
  return bScore - aScore;
});
```

Plus a `stageScore` helper that mirrors Stage 6's `computeFinalScore` minus the diversityPenalty (which doesn't exist yet at Stage 5 entry).

**Predicted eval impact:**

For the kurta fixture: zero (Stage 5 input doesn't contain the satisfying product). Same as fix (a).
For the PARTIAL_RECOVERY fixtures: marginal positive (~+0.02 aggregate). The second satisfying candidate in linen-shirts gets a rerank boost from fit-or-color-rerankers (it satisfies those axes), nudging its Stage 4 score above other non-satisfying candidates. Might move into top-6.

**With d.4 + a new tag_overlap reranker from fix (a):** combined behavior. The tag_overlap reranker would now actually affect selection. For linen-shirts: both satisfying candidates would carry tag_overlap boost = 0.3 (full match on category=shirt, color=white, material=linen). Non-satisfying candidates carry partial or zero overlap. Stage 5 picks both satisfying first. Score lifts to 2/6 = 0.333 on those fixtures.

For the kurta fixture: still zero (satisfying product not in Stage 5 input).

**Risks:**

1. **Diversity-vs-relevance trade-off shifts.** Sorting by Stage 4 score before applying MMR + quotas means MMR is applied to the rerank-sorted list. Diverse selections may suffer (a high-rerank-score cluster of similar products beats a low-rerank-score diverse alternative).
2. **The reorder is in tension with mech.5 D4** (Stage 5's greedy-MMR-soft-quotas algorithm explicitly assumed input was in Stage 4 relevance order). Reopening D4's premise.
3. **Stage 3's rerankBoost magnitudes matter more now.** The existing FIT_WEIGHT=0.3 may need re-tuning if it's now selection-effective rather than display-only. Risk of needing follow-on calibration.

**Architectural cleanliness:** moderate. Doesn't add a new pipeline-level concept; just changes Stage 5's iteration order. But it reopens a locked decision (D4) and changes the semantic role of rerankBoosts (display → selection).

**Recommendation:** **Promising standalone fix.** Especially if paired with fix (a)'s tag_overlap reranker — together they form a coherent "make tag-completeness affect top-K selection" architecture without the heavier Stage 1 or Stage 2 surgery.

For the kurta fixture, d.4 still doesn't help (Stage 2 narrowing is the bottleneck). For PARTIAL_RECOVERY fixtures, d.4 + (a) is a +0.02 to +0.04 eval lift. Smaller than d.2.

## Comparison matrix

| Shape | Code surface | Test surface | Eval recovery | Recovers kurta? | Risks |
|---|---|---|---:|---|---|
| Fix (a) alone | ~25 LOC | Low | 0 | No | Null result; false-positive impression |
| Fix (b) alone | ~80 LOC | Moderate | +0.028 | No | Stage 5 contract change |
| Fix (c-future) | 0-30 LOC | None | 0 (forward) | No | Process discipline drift |
| Fix (c-now) | 0 LOC | None | up to +0.05 | Yes (potential) | Catalog AI-tagger output quality |
| d.1 (a)+(c) | ~25 LOC + process | Low | 0 (forward) | No | Bundles null fix with policy |
| **d.2-strict** | ~50 LOC | Low | **+0.45** | **Yes** | Empty Stage 1 risk; extractor coupling |
| d.2-relaxed | ~50 LOC | Low | +0.30 | Partial | Less eval recovery; same coupling |
| d.3 | ~100 LOC | Moderate | +0.05 to +0.10 | Partial | Conflated concerns; SQL complexity |
| d.4 (Stage 5 re-sort) | ~30 LOC | Low | +0.02 to +0.04 | No | Reopens D4; calibration follow-on |
| **d.2-strict + (c-future)** | ~50 LOC + process | Low | **+0.45** | **Yes** | Strongest 3.1.8 candidate |

## Conclusion

The probe evidence pushed the analysis outside the original (a)/(b)/(c) framing. Two shapes dominate:

1. **d.2-strict** — Stage 1 secondary-axis hard filter on query-extracted axes. Largest eval recovery. Aligns with Stage 1's hard-filter identity. The right primary 3.1.8 fix.
2. **(c-future)** — proportional coverage discipline as planning-round + HANDOFF op-debt entry. Free. Prevents the next mech.4-style regression.

Pairing **d.2-strict + (c-future)** is the recommended shape. The architectural identity:
- d.2-strict makes Stage 1's hard filter respect ALL query-extracted axes, not just `category` and `gender`. The structural cause of the kurta regression (catalog data thin on secondary axes makes broader Stage 1 pools dilute relevance) gets reframed: Stage 1 returns only candidates with relevant secondary-axis APPROVED tags, so dilution is impossible by construction.
- (c-future) ensures that catalog expansion mechs (rule-engine, AI-tagger, bulk-approve) maintain proportional secondary-axis coverage so d.2-strict never returns empty Stage 1 pools on real merchant queries.

Together they form a coupled fix:
- d.2-strict is the structural enforcement (code).
- (c-future) is the process enforcement (catalog-data discipline).

Fix (a), (b), (c-now), (d.1), (d.3), (d.4) are subordinate options:
- (a) standalone is null.
- (b) is a marginal +0.028 fix; not load-bearing.
- (c-now) is a one-shot catalog tagging mech; complement to d.2 if eval recovery on the kurta fixture specifically matters at 3.1.8 timing.
- (d.1) bundles (a)+(c); (a) is null so (d.1) reduces to (c) alone.
- (d.3) has worse cleanliness than d.2.
- (d.4) reopens a locked decision for marginal gain.

The recommendation, locked: **d.2-strict + (c-future) as 3.1.8 primary fix**. Optionally pair with (c-now) for additional kurta recovery if R3.1 = 0.50+ is the target. (a)/(b)/(d.1)/(d.3)/(d.4) shelve for 3.2+ revisit.

This is the fourth-option-emerged-from-evidence shape that 3.1.7-Thread-3's "Option C-folded" precedent legitimizes. The (a)/(b)/(c) framing in the HANDOFF amendment was based on the architectural reading "Stages 2-5 don't weight tag-set overlap," which the probe shows is correct as a statement but incomplete as a fix-direction guide: the fix has to operate UPSTREAM of where Stages 2-5 see candidates, not WITHIN Stages 2-5.
