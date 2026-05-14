# Artifact 15 — Fix (a) simulation analysis

**Branch:** `throwaway/3-1-8-thread-3-fix-a-sim` (created `7a565aa`, deleted after eval capture, no commit ever landed on main).
**Eval result:** `.pr-3-1-8-planning-artifacts/14-fix-a-eval-result.txt` (`EvalRun cmp5oynuh0000q7mkbzp7noya`).
**Baseline for comparison:** `EvalRun cmp1dlvil0000q7gg3scb6rt7` (3.1.7 mech.4.5, aggregateScore 0.2917).

## Implementation summary

**File changed:** `app/lib/recommendations/v2/stage-3-rerank/fashion.server.ts`. ~25 LOC added (one new reranker function + weight constant + tuple registration).

**The fix:** added a fifth reranker `tagOverlapReRanker` to FASHION_NAMED_RERANKERS, weighted `TAG_OVERLAP_WEIGHT = 0.3`. The reranker aggregates across ALL extracted `queryAttributes` axes (not just occasion/fit/color):

```typescript
const tagOverlapReRanker: ReRanker = (candidate, ctx) => {
  const qa = ctx.queryAttributes;
  if (!candidate.tags) return 0;
  let totalQueryPairs = 0;
  let matchedPairs = 0;
  for (const [axis, values] of Object.entries(qa)) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const candValues = approvedValuesFor(candidate, axis);
    if (candValues.length === 0) {
      totalQueryPairs += values.length;
      continue;
    }
    for (const v of values) {
      totalQueryPairs += 1;
      if (candValues.includes(v)) matchedPairs += 1;
    }
  }
  if (totalQueryPairs === 0) return 0;
  return TAG_OVERLAP_WEIGHT * (matchedPairs / totalQueryPairs);
};
```

Test surface: 0 unit tests added or modified. If this fix were shipped for real, ~3-4 unit tests would land covering: (i) candidate with full overlap → boost = 0.3; (ii) candidate with partial overlap → boost = 0.3 × (matched/total); (iii) candidate with no overlap → boost = 0; (iv) empty queryAttributes → boost = 0.

## Eval delta — null result

| Metric | Baseline (post-mech.4, `cmp1dlvil...`) | Fix (a) (`cmp5oynuh...`) | Delta |
|---|---:|---:|---:|
| aggregateScore | 0.2917 | **0.2917** | **0.0000** |
| pass / partial / fail | 3 / 0 / 9 | 3 / 0 / 9 | 0 / 0 / 0 |

Per-fixture: every fixture's score is identical between baseline and fix (a):

| Fixture | Baseline | Fix (a) | Delta |
|---|---:|---:|---:|
| fashion-casual-office-shirts | 1.0000 | 1.0000 | 0 |
| fashion-festive-kurta-women | 0.0000 | 0.0000 | 0 |
| fashion-going-out-outfit | 0.0000 | 0.0000 | 0 |
| fashion-linen-shirts-white | 0.1667 | 0.1667 | 0 |
| fashion-minimalist-daily-wear | 0.1667 | 0.1667 | 0 |
| fashion-oos-stress-1 | 0.1667 | 0.1667 | 0 |
| fashion-oos-stress-2 | 0.0000 | 0.0000 | 0 |
| **fashion-oversized-fit-kurta** | **0.0000** | **0.0000** | **0** |
| fashion-show-jackets | 1.0000 | 1.0000 | 0 |
| fashion-show-trousers | 1.0000 | 1.0000 | 0 |
| fashion-summer-shorts-size-m | 0.0000 | 0.0000 | 0 |
| fashion-wedding-reception | 0.0000 | 0.0000 | 0 |

## Did fix (a) recover the kurta fixture?

**No.** Score stays at 0.0000 (FAIL). This confirms the architectural prediction from artifact 09 + 10 + 12.

## Did any fixture regress?

**No.** Score is identical at every fixture.

## Why the null result — load-bearing architectural reading

The fix (a) framing in the HANDOFF amendment (line 817) implies that adding a Stage 3 rerank tag-overlap signal would change top-K selection. The empirical result confirms it does not. The reason:

1. **Stage 5 iterates Stage 4 input in similarity-distance order** (per artifact 10 annotation). Stage 4 preserves Stage 3's order. Stage 3 (per locked decision D5) preserves Stage 2's order; it only attaches rerankBoosts.
2. **rerankBoosts only feed Stage 6 finalScore**, which is computed AFTER Stage 5 has selected its top-K.
3. **Final card ordering = Stage 5's selection order**. The display-side finalScore is recorded for trace and audit but doesn't reorder cards.

So fix (a)'s tagOverlapReRanker correctly produces non-zero boosts for tag-complete candidates, but those boosts contribute only to finalScore-on-card. They do NOT change which 6 candidates Stage 5 picks. The eval scoring only looks at which 6 cards came out + their APPROVED tags vs the fixture's `expectedTagFilters`; the finalScore field is not consulted.

## Why the kurta fixture specifically didn't move

From artifact 12 probe:
- Stage 1: 202 candidates, 2 with APPROVED `fit`. The 1 fit=relaxed candidate (the ONLY catalog product satisfying both `category=kurta` AND `fit IN {oversized, relaxed}`) does NOT survive Stage 2's top-50 narrowing.
- Even if fix (a) gave the fit=relaxed candidate a +0.3 boost on every signal axis it satisfies, the boost wouldn't matter — the candidate isn't in Stage 5's input.
- Stage 5's top-6 = positions 1-6 in Stage 2's similarity output (with quota/MMR shuffles). The fit=regular candidate at position 24 makes top-6 anyway (probe shows it at top-6 position 2). The fit=relaxed candidate at rank > 50 in Stage 2 cannot be recovered downstream.

## Why other PARTIAL_RECOVERY fixtures didn't move

For `fashion-linen-shirts-white` and `fashion-oos-stress-1`:
- Stage 1 has 26 candidates, 2 satisfying. Stage 2 returns all 26 (less than the 50 cap). Stage 5 picks 6.
- 1 of the 2 satisfying candidates is in top-6; the other is in Stage 5's input but doesn't make top-6.
- Stage 5 iterates in similarity order. The second satisfying candidate ranks lower than 6 by similarity. Stage 3's rerank boost (now +0.3 from tag_overlap) is added to finalScore, but Stage 5's selection was already made before finalScore exists.
- If fix (a) were paired with a Stage 5 change that *re-sorts by Stage 4 score before iterating* (i.e., re-sorts by `similarityScore + rerankBoostSum + merchantBoost`), THEN the rerank boosts would influence selection. That's a different fix shape (call it fix (e) — "rerank-aware Stage 5 iteration order"). Not the fix (a) framed in the HANDOFF.

## Cost/benefit assessment for 3.1.8 inclusion

| Dimension | Verdict |
|---|---|
| **Eval recovery** | 0 — null result on every fixture. |
| **Code complexity** | Low (~25 LOC + 3-4 tests). |
| **Test surface** | Minimal but additive. |
| **Architectural cleanliness** | Mid — adds a fifth reranker covering an additional concern. Consistent with the existing Stage 3 pattern. But it's a fix that does nothing measurable at the eval level. |
| **Diagnostic value** | Negative — would create the false impression that "fix (a) shipped" while not addressing the actual bottleneck. |
| **Recommendation for 3.1.8** | **Do not ship fix (a) as proposed.** The framing assumed Stage 3 rerank affects selection order; it does not. Shipping fix (a) without also addressing Stage 5's selection-by-similarity-only behavior produces no eval improvement. |

## Implication for the planning round

**The (a)/(b)/(c) fork in the HANDOFF amendment is incomplete.** The Stage 3 rerank framing of fix (a) is structurally insufficient — not because tag-overlap is the wrong signal, but because Stage 5 selection precedes Stage 6 finalScore computation. The fix as framed cannot affect eval outcomes.

For fix (a) to have eval impact, it would need to be paired with a Stage 5 change. Two coherent shapes:

- **(a-paired-with-resort)**: Stage 5 re-sorts its input by `Stage 4 score = similarityScore + rerankBoostSum + merchantBoost` before iterating. Then tag_overlap can influence selection order. Net code surface: ~50 LOC across Stage 3 + Stage 5.
- **(a-replaced-by-stage-2-boost)**: Move the tag-overlap signal to Stage 2 narrowing instead of Stage 3 rerank. Stage 2 ranks by `0.7 × similarityScore + 0.3 × tagCompletenessScore` instead of pure cosine. This puts the signal upstream of the narrowing bottleneck. Net code surface: ~30 LOC in Stage 2. But it changes Stage 2's algorithmic identity, which is a more architectural reach.

These shapes are explored in artifact 18 (fix (d) shapes).

## Predictions vs reality for Step 2 specifically

The Step 2 spec said: "Specifically: did `fashion-oversized-fit-kurta` recover to PARTIAL=0.50 or PASS=1.00? Did any OTHER fixture regress because the new signal favors different products?"

- **Kurta recovery prediction (Thread 3 spec):** PARTIAL=0.50 likely. **Reality:** FAIL=0.0000, no movement.
- **Regression prediction:** marginal possibility. **Reality:** no regression, no movement.

The kurta-recovery prediction was based on the HANDOFF amendment's framing of fix (a) as the "right architectural choice" for the ranking gap. The empirical evidence invalidates this framing — not because tag-overlap is the wrong concept, but because Stage 3 is the wrong stage to apply it given how Stage 5 ignores rerankBoosts in selection. The pre-investigation prediction was wrong.

This is the value of running the actual simulation rather than reasoning paper-and-pencil: the architectural premise check in artifact 10 (Stage 5 selection-by-similarity-only) was confirmed, and the load-bearing surprise — that the existing Stage 3 reranker pattern is essentially a no-op for top-K selection — would otherwise have been carried into 3.1.8 as a wrong assumption.

## Branch cleanup confirmed

```
$ git branch -D throwaway/3-1-8-thread-3-fix-a-sim
Deleted branch throwaway/3-1-8-thread-3-fix-a-sim (was 7a565aa).
$ git status
On branch main
Your branch is up to date with 'origin/main'.
```

No commit ever landed on main. Artifact 14 (the eval result text file) is the only durable trace.
