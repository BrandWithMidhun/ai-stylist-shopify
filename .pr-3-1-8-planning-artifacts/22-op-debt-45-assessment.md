# Artifact 22 — Op debt #45 assessment: in-stock ratio 2.5% on dev shop (real-merchant-pathology question)

## 1. Verbatim re-pull (HANDOFF.md:723)

> 45. `available=true` ratio on top-K cards is 2/44 (~4.5%) on the dev shop post-mech.2 (per `.pr-3-1-7-mech-2-artifacts/02-pipeline-end-to-end-post-mech-2.json`). Stages 2-5 rank by similarity / rerank / merchant signals / diversity, none of which weight availability. The in-stock subset (29/1,169 = 2.5% of universe on the dev shop) is rarely surfaced in top-K. Chat widget hides Add-to-Cart on the 42/44 OOS cards. **3.1.8 prerequisite:** before flipping v1→v2, decide whether the dev shop's 97.5% OOS catalog represents a real merchant pathology (in which case a Stage 3 availability boost or Stage 5 in-stock quota is needed before the flip ships) or a dev-shop-specific catalog health issue (in which case the 3.1.8 flip ships as designed and real merchants exhibit higher in-stock ratios). Counter-argument captured at planning-round close as op debt #42 (Stage 3 weighting alternative); this is the empirical evidence #42 was hedging against.

## 2. Current empirical state

Probe output (`_catalog-state-output.txt`):

```
ACTIVE+not-deleted+not-excluded:  1169
+ embedding NOT NULL:             1169
+ availableForSale variant:       29
In-stock ratio: 29/1169 = 2.48%
```

**No drift since 3.1.7.** The 29-of-1169 ratio (2.48% — slightly lower than the HANDOFF entry's 2.5% rounding) is unchanged. The 1168 number from HANDOFF mech.4.5 is the same 1169 count (one product appears as both "active" and was probably added/removed since).

Top-K availability ratio re-measurement: not performed in this probe (would require running the pipeline for each fixture and counting `available=true` on the returned cards). Skipped because it doesn't change the structural finding: the dev shop's catalog has 2.48% in-stock, so any top-K will reflect that ratio absent ranking changes.

## 3. Scope estimate — what closing this debt requires

The debt itself is a DECISION, not an implementation. The HANDOFF entry names two opposed framings:

- **Framing α:** dev shop's 97.5% OOS is a "real merchant pathology" that will recur. Implies Stage 3 availability boost or Stage 5 in-stock quota implementation (overlaps with op debt #42's "Stage 3 weighting alternative").
- **Framing β:** dev shop's 97.5% OOS is a dev-shop-specific catalog health issue. Implies the flip ships as designed; real merchants are expected to have 60-80%+ in-stock ratios.

**Closing the decision requires:**
1. Empirical data from at least one real-merchant shop's in-stock ratio (post-onboarding) to anchor the typical-merchant distribution.
2. A Stage-3-availability-boost or Stage-5-quota implementation IF framing α is selected (~30-50 LOC + tests).
3. No code change IF framing β is selected (the flip ships with current binary Stage 6 `available` attachment).

The current 3.1.8 evidence base (the dev shop alone) is insufficient to resolve the framing question. The decision is essentially "guess what real merchants look like" until production traffic supplies the data.

## 4. Implementation surface

If framing α wins:
- **`app/lib/recommendations/v2/stage-3-rerank/fashion.server.ts`:** add `availabilityReRanker` (~30 LOC + 3 unit tests). Boost candidate.merchantSignals if `loadedVariant?.availableForSale === true`.
- **OR `app/lib/recommendations/v2/stage-5-diversity.server.ts`:** add in-stock quota (top-K must include at least N cards with `loadedVariant?.availableForSale === true`). ~40 LOC + 3 unit tests.
- **Test surface:** moderate; ~3-5 tests per implementation.

If framing β wins: 0 LOC.

## 5. Eval movement prediction

The eval scoring (relaxedMatchAtK + precisionAtK) does NOT measure availability — it measures tag-set overlap with `expectedTagFilters`. So any availability fix has ZERO eval impact on the current fixture suite.

The user-facing chat widget behavior IS affected — Stage 6's `available` attachment determines whether Add-to-Cart appears. v2's current binary attachment correctly reflects the underlying variant state. Adding a Stage 3 boost or Stage 5 quota would change which cards are SELECTED, not how the chat widget RENDERS the cards.

If the chat widget's UX-quality measurement (Add-to-Cart visibility ratio on returned cards) became part of the eval, this debt would have measurable impact. Currently it doesn't.

**Eval movement prediction: 0.**

## 6. Coupling to other debts

- **#42 multi-merchant OOS policy diversification:** #45 IS the empirical evidence #42 hedged against. They share the same architectural decision space (binary include/exclude at Stage 6 vs probabilistic Stage 3 weighting). Resolving #45 likely also resolves #42's "revisit at Phase 5+" framing.
- **#50 multi-tenant verification:** #45's framing question can only be answered with multi-shop data. Closure depends on Phase 5+ onboarding.
- **#15 variant-loading (closed in 3.1.7 mech.2):** prerequisite to #45 — without variant-loading, there's no way to know whether candidates are in-stock. Already closed.

No tight coupling forcing 3.1.8 ordering.

## 7. Triage verdict

**(N) next-sub-bundle** — and even **(P) Phase 5+** is a defensible refinement.

Reasoning:
- The decision question requires multi-shop data that 3.1.8 doesn't have access to. Resolving the framing-α-vs-β fork in 3.1.8 is guesswork against dev-shop evidence alone.
- Real-merchant traffic post-flip provides the empirical anchor needed. Option α flip (Thread 3 recommendation) is consistent with this: ship the flip, let production data inform the answer.
- Eval movement from closure is 0 regardless of framing. So there's no eval-progress argument for bundling.
- The current binary Stage 6 `available` decision (mech.5 D6 → 3.1.7 mech.1 D1) handles the structural case correctly: products without an available variant don't get `available=true`. Users see the OOS state via the chat widget's hide-Add-to-Cart logic. The pipeline isn't broken; it's reflecting catalog reality.

**Why this isn't flip-blocking (F):** the flip ships v2 against the current catalog state. v2's Stage 6 binary `available` is correct per the locked decision; only the framing-α counterfactual (where availability should be a ranking signal) would require pre-flip work.

**Recommendation:** carry to 3.2 as a deferred decision; revisit when production traffic provides multi-shop data. Mark the decision register entry (when one exists per op debt #41) with the framing-α vs framing-β fork as an open question.
