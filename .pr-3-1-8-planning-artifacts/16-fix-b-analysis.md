# Artifact 16 — Fix (b) paper-and-pencil analysis

**Fix (b) (from HANDOFF amendment lines 818):**
> "Stage 5 quota policy: add a per-fixture-axis-coverage quota so the top-K must include at least N cards satisfying the per-axis filter (when feasible from the candidate pool)."

## 1. Code surface analysis

**File:** `app/lib/recommendations/v2/stage-5-diversity.server.ts`. ~80 LOC added, broken down:
- New plumbing on the function signature: `stage5Diversity` would need to accept `queryAttributes` so it can derive "satisfies axis X" per candidate. Currently it takes only `(stage4Candidates, targetN)`. New signature: `(stage4Candidates, queryAttributes, targetN)`. Touches `pipeline.server.ts` at the call site (~1 LOC) plus the Stage 5 unit tests (~5-10 LOC).
- New constant: `MIN_AXIS_SATISFIED_PER_AXIS = 1` (or 0 — see "Behavior simulation" below).
- New logic inside the iteration loop:
  - Track per-axis "satisfied count": `Map<axis, number>`.
  - At Stage 5's existing first-pass selection step, when reaching iteration `i` such that `cap - selected.length === number_of_under_quota_axes`, prefer to select from `skipped` candidates that satisfy an under-quota axis. (Alternative: insert a pre-fallback "axis-coverage pass" between the first pass and the existing skipped-fallback pass.)

The cleanest implementation is **option (a) — pre-fallback axis-coverage pass:**

```typescript
// After first pass, before existing skipped-fallback:
const axisSatisfied: Record<string, number> = {};
for (const c of selected) {
  for (const [axis, allowed] of Object.entries(queryAttributes)) {
    if (candidateSatisfiesAxis(c, axis, allowed)) {
      axisSatisfied[axis] = (axisSatisfied[axis] || 0) + 1;
    }
  }
}

if (selected.length < cap) {
  const underQuotaAxes = Object.entries(queryAttributes)
    .filter(([axis]) => (axisSatisfied[axis] || 0) < MIN_AXIS_SATISFIED_PER_AXIS)
    .map(([axis]) => axis);

  // Scan skipped in original order. Prefer candidates that satisfy an
  // under-quota axis. Add them to selected; reset their diversityPenalty
  // to match the first-pass skipped state.
  const axisCoverageFilled: number[] = []; // indices into skipped
  for (let i = 0; i < skipped.length; i++) {
    if (selected.length >= cap) break;
    const s = skipped[i];
    const helpsAxis = underQuotaAxes.some((axis) =>
      candidateSatisfiesAxis(s.candidate, axis, queryAttributes[axis]),
    );
    if (helpsAxis) {
      selected.push({ ...s.candidate, diversityPenalty: s.rejectionPenalty });
      axisCoverageFilled.push(i);
      // Update axisSatisfied counts...
    }
  }
  // Remove filled indices from skipped before the generic fallback runs.
  // ... (cleanup)
}

// Existing generic fallback fires next if selected.length < cap.
```

Test surface: 3-4 new unit tests covering: (i) axis-coverage pass fires when first pass under-fills, (ii) axis-coverage pass prefers axis-satisfying candidates from skipped, (iii) interaction with existing generic-fallback pass.

## 2. Behavior simulation against the kurta fixture

Using artifact 12's candidate-pool data:

- Stage 1: 202 candidates. 1 satisfies the fixture's expectedTagFilters (`category=kurta AND fit IN {oversized, relaxed}`): `cmoeelkxq00zio436pji1ms7o` (fit=relaxed).
- Stage 2: top-50 by similarity. **The 1 satisfying product does NOT survive Stage 2 narrowing** (per probe data).
- Stage 5: input is 50 candidates, NONE of which satisfy the per-axis filter (every kurta in the top-50 has either no APPROVED `fit` or fit=regular).

**Fix (b) cannot help the kurta fixture.** The axis-coverage pass scans `skipped` for candidates satisfying an under-quota axis. `skipped` is the set of candidates rejected by the first pass — i.e., candidates that were in Stage 2's top-50 but didn't make Stage 5's top-6. None of those have APPROVED `fit IN {oversized, relaxed}`. The pass finds no axis-satisfying candidate to promote.

This is the SAME structural reason fix (a) failed: the satisfying product isn't in Stage 5's input pool.

## 3. Behavior simulation against the PARTIAL_RECOVERY fixtures

For `fashion-linen-shirts-white` and `fashion-oos-stress-1`:
- Stage 1: 26 candidates. 2 satisfy expectedTagFilters.
- Stage 2: returns all 26 (less than 50 cap).
- Stage 5's first pass: iterates in similarity order. Top-6 includes 1 of the 2 satisfying candidates. The other satisfying candidate is in `skipped` (rejected by category=2 quota or color=3 quota or jaccard MMR).
- **Fix (b)'s axis-coverage pass would fire** (under-quota on at least 1 axis with `MIN_AXIS_SATISFIED_PER_AXIS=2` — but with `=1`, axis already has 1 satisfying, pass is a no-op).

Two parameterizations of `MIN_AXIS_SATISFIED_PER_AXIS`:
- **=1:** doesn't help linen-shirts or oos-stress-1 (their first pass already gets 1 satisfying card).
- **=2:** triggers axis-coverage for these fixtures. Likely promotes the second satisfying candidate from skipped into top-6.

For `=2`:
- Linen-shirts: 2 satisfying / 6 = 0.333 (still FAIL bucket, but score moves up from 0.167).
- Oos-stress-1: same expected delta.

For `fashion-minimalist-daily-wear`:
- Stage 1: 1000 (at cap). 37 satisfy.
- Stage 2: 50 in pool. **Only 1 satisfies** (the per-fixture probe showed `stage2SatisfyingCount=1`).
- Stage 5 first pass: picks 1 satisfying into top-6 (so 1/6 = 0.167, current behavior).
- Fix (b) `=2`: axis-coverage pass scans skipped; no other satisfying candidate in Stage 2's input. Pass is a no-op.
- **No movement.**

**Net eval impact for fix (b) with `MIN_AXIS_SATISFIED_PER_AXIS=2`:**
- linen-shirts-white: +0.167 (0.167 → 0.333)
- oos-stress-1: +0.167 (0.167 → 0.333)
- minimalist-daily-wear: 0 (Stage 2 bottleneck)
- All others: 0
- aggregateScore delta: ~(0.167 + 0.167)/12 = **+0.028** (0.2917 → 0.3194).

Still FAIL bucket on both moved fixtures. But the partial-credit movement is real and could push the eval forward.

For `MIN_AXIS_SATISFIED_PER_AXIS=1`: no eval impact (it's a no-op for everything currently at ≥1 satisfying).

## 4. Cross-fixture implications

Could fix (b) hurt any fixture's score?

- **Healthy fixtures (PASS bucket):** casual-office-shirts (24/26 satisfying in top-6 = 6/6 = 1.0), show-jackets (5/5 = 1.0), show-trousers (6/8 = 1.0). For all three, the first-pass already produces a fully-satisfying top-K; the axis-coverage pass finds no under-quota axis and is a no-op.
- **EMPTY_STAGE_1 fixtures:** kurta-women, oos-stress-2. Stage 1 returns 0; Stage 5 is never entered. No change.
- **NO_SATISFYING_IN_CATALOG_POOL:** summer-shorts-size-m. Stage 1 returns 53, 0 satisfy. Stage 5 input has 0 satisfying. Axis-coverage pass finds no satisfying in skipped. No change.
- **STAGE_2_NARROWING_DROPS_SATISFYING:** kurta (0 in pool), going-out (0 in pool after Stage 2), wedding-reception (0 in pool). Fix (b) is a no-op.

**No regressions predicted.** Fix (b) is structurally additive (only promotes from `skipped`, never demotes from `selected`).

Potential subtle interaction: if MMR cap or category-quota in the first pass is the reason a satisfying candidate ends up in skipped, the axis-coverage pass effectively overrides those for axis-coverage purposes. This could trade diversity for filter satisfaction. Concrete worry: linen-shirts top-6 currently is "1 satisfying linen-white-shirt + 5 diverse-by-MMR linen-or-shirts". Fix (b) `=2` promotes the second satisfying into the top-6 (likely also a linen-white-shirt), making top-6 "2 linen-white-shirts + 4 diverse-by-MMR". For the user-facing display, this means slightly less variety but more on-topic results. Subjective trade-off; eval-wise it's positive.

## 5. Comparison to fix (a)

| Dimension | Fix (a) | Fix (b) |
|---|---|---|
| **Eval recovery** | 0 (simulated) | +0.028 with `MIN=2`; 0 with `MIN=1` |
| **Code surface** | ~25 LOC | ~80 LOC + new arg plumbing through pipeline |
| **Architectural fit** | Adds fifth reranker, consistent with existing pattern | Stage 5 needs to know queryAttributes, breaks D5's "Stage 5 doesn't know query intent" principle |
| **Diagnostic value** | Negative (creates false-positive impression of progress) | Positive (the eval movement is real) |
| **Recovers kurta regression** | No | No |

**Fix (b) is structurally different from (a):** (a) is a gradient signal in Stage 3, (b) is a binary backtrack in Stage 5. (b) actually changes selection; (a) does not. So they're not interchangeable.

But (b) still doesn't fix the kurta fixture — the Stage 2 narrowing bottleneck is upstream.

## 6. Stage 5 architectural concern

Stage 5's current contract:
- Input: candidates with `similarityDistance`, `rerankBoosts`, `merchantSignals`, `tags`.
- Selection logic: greedy MMR + soft quotas.
- Stage 5 does NOT consume queryAttributes.

Fix (b) breaks this contract. Stage 5 becomes coupled to query intent. The design rationale for keeping Stage 5 query-blind (per mech.5 D4): Stage 5's job is diversity, not relevance. Relevance was Stage 3's responsibility.

Plumbing alternative: derive "candidate satisfies axis X" from `candidate.rerankBoosts` rather than from `queryAttributes` directly. The existing rerankers per-axis are essentially axis-satisfaction checks (boost > 0 ⇒ satisfies axis). This decouples Stage 5 from query intent: Stage 5 uses `rerankBoosts.X > 0` as the satisfaction signal.

```typescript
function candidateSatisfiesAxis(c: CandidateProduct, axisName: string): boolean {
  return (c.rerankBoosts?.[axisName] ?? 0) > 0;
}
```

This shape is cleaner. Stage 5 stays query-blind but consults its own input (rerankBoosts) for axis-satisfaction. Downside: it only covers axes for which there's a reranker in Stage 3 (occasion, fit, color, body_type in current FASHION). Adding new axis coverage requires adding rerankers.

The `tag_overlap` reranker from fix (a) bridges this gap — if both fix (a) and fix (b) are shipped together, fix (a)'s tag_overlap reranker becomes the "did this candidate satisfy ANY extracted axis" signal that fix (b) can consume. This is a coherent hybrid (see artifact 18 d.1).

## 7. Cost/benefit assessment for 3.1.8 inclusion

| Dimension | Verdict |
|---|---|
| **Eval recovery** | +0.028 (with MIN=2) on two fixtures; doesn't help kurta or going-out or wedding-reception. |
| **Code complexity** | Moderate (~80 LOC + plumbing through pipeline). |
| **Test surface** | Moderate. |
| **Architectural cleanliness** | Lower than (a) — breaks Stage 5's query-blindness contract. The rerankBoosts-derived shape is cleaner but only covers axes with existing rerankers. |
| **Diagnostic value** | Positive — the +0.028 eval movement is real, attributable to a known mechanism (per-axis backtrack from skipped). |
| **Recommendation for 3.1.8** | **Conditionally shippable.** As a standalone fix, marginal eval value. Not load-bearing for the planning round. Better as a co-shipped pair with a Stage 2 fix that addresses the kurta/going-out/wedding-reception bottleneck. |

## 8. Implication for the (a)/(b)/(c) fork

Fix (b) is the only one of (a)/(b)/(c) that produces a non-zero eval delta — but only +0.028, and only on fixtures whose Stage 1 pools are small enough to keep satisfying candidates in Stage 5's input. The three STAGE_2_NARROWING fixtures (kurta, going-out, wedding-reception) are bottlenecked upstream of where fix (b) operates.

For the planning round: fix (b) is a candidate fix, not the right fix on its own. Pairing with a Stage 2 fix (artifact 18 d.X shapes) is structurally promising. Combined-fix prediction: pair (b) with Stage 2 candidatePool raise from 50 → 200, the kurta fit=relaxed candidate enters Stage 5's input, fix (b) `=1` promotes it (since other top-6 cards are kurta with no fit IN {oversized,relaxed}). Score moves from 0 → 0.167 (still FAIL but partial credit recovered).
