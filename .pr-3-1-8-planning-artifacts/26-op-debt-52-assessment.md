# Artifact 26 — Op debt #52 assessment: Stage 5 ignores rerankBoosts in selection-eligibility decisions

## 1. Verbatim re-pull (Thread 3 artifact 20 § 7, candidate op debt #52)

> #52 — Stage 5 ignores rerankBoosts in selection-eligibility decisions. Stage 5 iterates Stage 4 input in similarity-distance order (preserved through Stage 3+4). The rerankBoosts attached by Stage 3 feed Stage 6 finalScore only; they do NOT affect Stage 5's top-K selection. Artifact 10 + 15 documents this. Implication: existing FASHION rerankers (occasion, fit, color, body_type) influence display ordering but not which candidates make top-K. Future Stage 3 rerank work must be paired with a Stage 5 change (e.g., (d.4) rerank-aware iteration order) for the rerank to be selection-effective. **Priority: Medium.** Re-visit at 3.2 planning round if d.4-style architecture is preferred over d.2.

## 2. Current empirical state

No probe needed; the finding is a code-reading observation, not a data-drift question. Re-confirmed via Thread 3 artifact 10 + 15:

- `stage5Diversity()` iterates `stage4Candidates` in input order (`for (const candidate of stage4Candidates)`).
- Stage 4 preserves Stage 3 order; Stage 3 (locked decision D5) preserves Stage 2 order, only attaches rerankBoosts.
- Stage 2 orders by `similarityDistance ASC`.
- `rerankBoosts` only feed `computeFinalScore` in Stage 6, which runs AFTER Stage 5 has already selected.
- Empirical proof: artifact 14's null-result eval (aggregateScore identical to baseline even with a tag_overlap reranker active).

This op debt is a structural property of the locked pipeline architecture. Not a bug; an unintended downstream effect of decisions D5 (Stage 3 preserves order) + D4 (Stage 5 iterates Stage 4 relevance order + applies greedy MMR).

## 3. Scope estimate — what closing this debt requires

The fix is the Thread 3 artifact 18 (d.4) shape: Stage 5 re-sorts its input by Stage 4 score before iterating.

Concrete implementation:
- In `stage-5-diversity.server.ts`, before the main `for` loop, sort the candidate list by `similarityScore + rerankBoostSum + merchantBoost`. ~10 LOC.
- Add a helper `stageScore(c: CandidateProduct): number` mirroring `computeFinalScore` minus the diversityPenalty (which doesn't exist yet at Stage 5 entry). ~10 LOC.
- Update Stage 5 unit tests to verify the new ordering. ~3-5 test updates.
- Optionally: re-tune the FASHION reranker weights (OCCASION_WEIGHT=0.4, FIT_WEIGHT=0.3, COLOR_WEIGHT=0.2, BODY_TYPE_WEIGHT=0.15) since they're now selection-effective rather than display-only. ~uncertain; calibration work.

Total scope: ~30 LOC + 5 tests + optional calibration follow-on.

## 4. Implementation surface

- **`app/lib/recommendations/v2/stage-5-diversity.server.ts`** — primary site.
- **Stage 5 unit tests** in `stage-5-diversity.test.ts` (file exists, holds the locked-decision D4 test cases).
- **No new module** — the change stays within Stage 5.
- **No plumbing changes** through `pipeline.server.ts` — Stage 5 already receives `rerankBoosts` and `merchantSignals` on each candidate.

This is a contained change to Stage 5's iteration order. Reversibility is moderate; the iteration-order change reopens locked decision D4 ("Stage 5 iterates in Stage 4 relevance order"), so an architectural decision documentation update is also needed.

## 5. Eval movement prediction

From Thread 3 artifact 18 (d.4): "+0.02 to +0.04 paired with fix (a)'s tag_overlap reranker." Standalone (without an additional tag_overlap reranker), the existing FASHION rerankers would influence selection but only on the axes they already cover (occasion, fit, color, body_type). The body_type reranker is a no-op in eval (profile=null on all fixtures), so effectively only occasion + fit + color affect selection.

For the kurta fixture: Stage 5 input contains 1 fit-tagged candidate (fit=regular), which gets `fit` boost = 0 (because queryAttributes.fit=["oversized"] doesn't include "regular"). No movement.

For PARTIAL_RECOVERY fixtures (linen-shirts, oos-stress-1): 2 satisfying candidates in Stage 5 input, but they're already similar-distance-close (jaccard-close → MMR cap). The re-sort might shuffle order but likely doesn't move the second satisfying candidate into top-6.

**Eval movement prediction: 0 to +0.02.** Standalone #52 closure has minimal eval value.

Paired with tag_overlap reranker (fix (a)): +0.02 to +0.04 (per Thread 3 artifact 18 d.4 analysis).

Paired with d.2-strict (Thread 3's recommended fix): no direct interaction. d.2-strict moves the filter to Stage 1; Stage 5 still iterates by similarity. d.2-strict doesn't make #52 closure more or less valuable.

## 6. Coupling to other debts

- **#53 Stage 2 candidatePool dilution:** closely related. Both are Stage 2-5 ranking-architecture concerns. Resolving #52 doesn't fix #53; resolving #53 (e.g., raising candidatePool from 50 to 200) doesn't fix #52.
- **d.2-strict (Thread 3 recommendation for 3.2):** orthogonal. d.2-strict and #52 address different layers. Both can ship in 3.2; not interdependent.
- **#55 deferred architectural finding:** #52 is one of the architectural concerns #55 deferred. If d.2-strict ships in 3.2 and #52 doesn't, the FASHION rerankers stay display-only and the rerank work becomes a known-no-op for selection.
- **#54 relaxedMatchAtK denominator semantics:** unrelated.

#52 + #53 cluster naturally as "Stage 2-5 ranking-architecture cluster" for 3.2.

## 7. Triage verdict

**(N) next-sub-bundle.**

Reasoning:
- The flip doesn't depend on #52. v1 has no Stage 5 (it's a flat nearest-neighbor over embeddings); the flip moves to v2's pipeline which has this property. Users see the same ranking-by-similarity behavior post-flip whether or not #52 is closed.
- Standalone closure adds minimal eval value (~+0.02 at best).
- Paired with d.2-strict (3.2 work), #52 closure is one option for making FASHION rerankers selection-effective; but Thread 3 already recommended d.2-strict (which doesn't require #52) as the primary 3.2 fix. So #52 may stay deferred even into 3.2.

**Why NOT bundle-with-flip (B):**
- Scope is small (~30 LOC) but eval value is minimal. Bundling adds churn without proportional return.
- Reopening locked decision D4 ("Stage 5 iterates in Stage 4 relevance order") is a non-trivial architectural decision that warrants its own planning-round discussion, not a 3.1.8 bundle.

**Why NOT Phase 5+ (P):**
- The decision affects v2 pipeline architecture, not multi-tenant onboarding. It's a Phase 3 territory concern.

**Recommendation:** carry to 3.2, but only as an optional fix to consider IF d.2-strict's empty-Stage-1 risk surfaces problems with production traffic. If d.2-strict performs well, #52 may not need resolution — the FASHION rerankers' display-only role is acceptable if Stage 1's hard-filter ensures all candidates are tag-complete.

Possible upgrade to **(P) Phase 5+** if 3.2 prefers d.2-strict alone and defers #52 indefinitely. The op debt then carries to the next ranking-architecture revisit (Phase 5 multi-mode rerankers or later).
