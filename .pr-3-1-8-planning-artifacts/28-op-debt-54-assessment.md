# Artifact 28 — Op debt #54 assessment: relaxedMatchAtK denominator semantics

## 1. Verbatim re-pull (Thread 3 artifact 20 § 7, candidate op debt #54)

> #54 — `relaxedMatchAtK` denominator semantics make small-pool fixtures structurally favored. `relaxedMatchAtK` (in `app/lib/recommendations/v2/eval/scoring.ts:91`) normalizes by `Math.max(1, top.length)` rather than by K. Pre-mech.4 kurta scored 1/2=0.50 PARTIAL because Stage 1 returned only 2 candidates. Post-mech.4 kurta with the same single satisfying card would max at 1/6=0.167 FAIL. The pre-mech.4 0.3333 baseline is therefore not architecturally recoverable from any code-side fix unless catalog data grows or scoring policy changes (max with K instead of returned-count). **Priority: Medium.** Surface to planning-round-close decision: do we keep current normalization or switch to K-based?

## 2. Current empirical state

`app/lib/recommendations/v2/eval/scoring.ts:42-92`:

```typescript
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
    // ... per-axis satisfaction check ...
    if (satisfies) satisfying += 1;
  }
  return satisfying / Math.max(1, top.length);
}
```

The denominator is `Math.max(1, top.length)`, i.e., `min(actualWithTags.length, k)`. When fewer than K candidates are returned, the denominator shrinks.

**Effect on R3.0 = 0.2917:**

| Fixture | top.length | satisfying | current (denom=top.length) | K-based (denom=K=6) |
|---|---:|---:|---:|---:|
| casual-office-shirts | 6 | 6 | 1.000 | 1.000 |
| festive-kurta-women | 0 | 0 | 0 | 0 |
| going-out-outfit | 6 | 0 | 0 | 0 |
| linen-shirts-white | 6 | 1 | 0.167 | 0.167 |
| minimalist-daily-wear | 6 | 1 | 0.167 | 0.167 |
| oos-stress-1 | 6 | 1 | 0.167 | 0.167 |
| oos-stress-2 | 0 | 0 | 0 | 0 |
| oversized-fit-kurta | 6 | 0 | 0 | 0 |
| show-jackets | 5 | 5 | **1.000** | **0.833** |
| show-trousers | 6 | 6 | 1.000 | 1.000 |
| summer-shorts-size-m | 6 | 0 | 0 | 0 |
| wedding-reception | 6 | 0 | 0 | 0 |
| **Aggregate** | | | **0.2917** | **0.2778** |

Under K-based normalization, R3.0 shifts from **0.2917 → 0.2778** (delta -0.0139). The only fixture affected is `fashion-show-jackets`, which currently scores 5/5 = 1.000 under current rules and 5/6 = 0.833 under K-based.

**Effect on R3 ladder history:**

| Anchor | Current rules | K-based |
|---|---:|---:|
| pre-3.1.7 (1 PASS at 1.0 / 12 = 0.0833) | 0.0833 | likely lower (trousers fixture had 1 candidate; under K-based 1/6=0.167 vs current 1/1=1.0; would push baseline LOWER) |
| mech.1 (universe expansion) | 0.1667 | unchanged proportionally |
| mech.3 (secondary axes) | 0.3333 | likely lower (similar denominator effect on small-pool fixtures) |
| mech.4 (rule-engine pass) | 0.2917 | 0.2778 |
| mech.3.5 peak | 0.3333 | unclear |

The historical R3 trajectory is partially distorted by the denominator semantics. The pre-mech.4 0.3333 came partly from the kurta fixture's small-pool 1/2 = 0.50 score. Under K-based, that score would have been 1/2 → 1/6 = 0.167 already.

## 3. Scope estimate — what closing this debt requires

**Option (a) — switch to K-based normalization:**
- `app/lib/recommendations/v2/eval/scoring.ts:91`: change `Math.max(1, top.length)` to `Math.max(1, k)`. ~1 LOC.
- Update 2 existing tests in `scoring.test.ts` that test the current denominator behavior. ~5-10 LOC.
- Re-run eval to capture new aggregateScore. ~10 minutes.
- HANDOFF amendment: re-anchor R3.0/R3.1/R3.2 with new numbers.

Total scope: ~15 LOC + HANDOFF re-anchor + eval rerun. **Trivial code change.**

**Option (b) — keep current normalization, document the property:**
- Add comment block to `scoring.ts:91` documenting the denominator semantics and the small-pool incentive. ~10 LOC.
- HANDOFF amendment: document the property as a known eval artifact.

Total scope: ~10 LOC of doc + HANDOFF entry.

**Option (c) — hybrid: K-based by default, configurable via fixture field:**
- Allow individual fixtures to specify their own denominator (e.g., `denominatorPolicy: "K" | "returned"`). ~30 LOC + fixture schema change.

## 4. Implementation surface

If option (a) is chosen:
- **`app/lib/recommendations/v2/eval/scoring.ts`** — 1-line change.
- **`app/lib/recommendations/v2/eval/scoring.test.ts`** — 2 test updates.
- **`HANDOFF.md`** — re-anchor R3.0/R3.1/R3.2 in the close subsection.

If option (b):
- Doc-only.

## 5. Eval movement prediction

Option (a) (switch to K-based):
- R3.0: 0.2917 → 0.2778 (-0.0139). Small but non-zero.
- Show-jackets fixture's PASS status: 1.000 → 0.833. Still above PASS_THRESHOLD=0.75; remains PASS.
- pass/partial/fail counts: unchanged (3/0/9 → 3/0/9).
- d.2-strict prediction (Thread 3 artifact 18): under current rules, d.2-strict predicted aggregateScore ~0.75. Under K-based, the same recovery pattern produces slightly lower numbers because some recovered fixtures may have stage5Count < 6 (e.g., kurta would recover to 1/1 = 1.0 under current rules but 1/6 = 0.167 under K-based, if d.2-strict shrinks Stage 1 to 1 candidate).

Critically, **K-based eliminates the small-pool incentive that mech.4 surfaced as a regression source.** Under K-based:
- Pre-mech.4 kurta: 1 satisfying / 6 K = 0.167 (FAIL bucket already; would have been FAIL not PARTIAL).
- Post-mech.4 kurta: 1 satisfying / 6 K = 0.167 (same).
- mech.4's regression would have been invisible to aggregate score (both states 0.167 = FAIL).

This is the load-bearing observation: **mech.4's eval regression was an artifact of the denominator-favors-small-pools property**. Under K-based scoring, mech.4 produced no regression because the kurta fixture was already FAIL under the broader-Stage-1-pool interpretation.

## 6. Coupling to other debts

- **#53 Stage 2 candidatePool dilution:** weak coupling. d.2-strict (the #53 fix) shrinks Stage 1; under current denominator, this re-creates small-pool advantages. Under K-based, d.2-strict's recovery is bounded by K, not pool-size-luck.
- **R3 ladder (planning round close decision):** strong coupling. The R3.1 = 0.2917 target depends on which denominator semantics are locked. Different semantics produce different R3.0/R3.1/R3.2 numbers.
- **All other debts:** indirect. The denominator affects eval interpretation broadly; individual debts' eval-impact predictions in their respective assessments assume current rules.

## 7. Triage verdict

**(B) bundle-with-flip.**

Reasoning (counter to the spec's predicted F):

The flip itself ships at R3.0 = 0.2917 under whichever denominator semantics are locked. The flip is the registry edit; the flip's verification is "v2 eval ≥ R3.1." If R3.1 is anchored at 0.2917 under current rules OR 0.2778 under K-based, either is verifiable.

**Why bundle (B) rather than carry (N):**
- The change is ~15 LOC. Trivially small.
- The change cleanly bundles with the 3.1.8 close commit's HANDOFF amendment (which already re-anchors R3 numbers per Thread 3).
- Surfacing the denominator semantics as a deliberate planning-round-close decision PREVENTS the pattern where future eval changes silently distort the R3 ladder. The 3.1.7 mech.4 regression itself was caused by an unanticipated denominator interaction; explicitly locking the rule prevents recurrence.
- Bundling locks the measurement contract at the same time the flip locks the architecture contract.

**Why NOT flip-blocking (F):**
- The flip is verifiable under either denominator semantics; F overstates the urgency.
- F adds 2-3 mechs to 3.1.8 (denominator change + re-anchor + verification) that aren't strictly required for the flip itself. Discipline pattern: keep 3.1.8 scope small.

**Why NOT next-sub-bundle (N):**
- Deferring #54 means R3.1's "no regression" semantic is anchored to an arbitrary mech.4 result. Locking the measurement contract early provides a cleaner trajectory across 3.2-Phase 4.
- The change is so small (~15 LOC) that "defer" doesn't save meaningful scope.

**Recommendation:** bundle in 3.1.8 close. Switch to K-based normalization. Re-anchor R3.0/R3.1/R3.2 in the HANDOFF amendment.

- R3.0 (re-anchored under K-based): 0.2778
- R3.1 (3.1.8 flip target): ≥ 0.2778 (no regression)
- R3.2 (Phase 5 multi-mode): ≥ 0.50 (unchanged; the target is policy-level)

The pre-mech.4 0.3333 peak ceases to be a meaningful anchor under K-based; the trajectory recovers to a measurement-contract-stable shape.

**Alternative: if the planning round prefers minimum-3.1.8-scope, (N) carry-forward is defensible.** Then R3.0 stays at 0.2917 under current rules, #54 is logged as a 3.2 decision, and the trajectory continues under current normalization. Trade-off: the small-pool incentive remains, and future mech.4-style regressions can recur.

**This is the load-bearing Thread 2 finding to surface to the planning-round close.** The spec predicted #54 might be the surprise; the analysis confirms it is the most impactful triage decision in Thread 2.
