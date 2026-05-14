# Artifact 19 — Flip ordering analysis

**The fork from the 3.1.7 close (HANDOFF line 821):**
> "Option α: ship the flip without addressing the ranking gap (R3.1 = 0.2917 acceptable; ranking-gap-fix as 3.2+ work)
> Option β: fix the ranking gap before the flip (R3.1 = 0.3333+ target; flip gated on fix completion)"

This artifact assesses ordering AGAINST the locked Thread-3 fix recommendation (artifact 18 § conclusion): **d.2-strict + (c-future) as the 3.1.8 primary fix.**

The fork question is: does d.2-strict + (c-future) ship BEFORE the v1→v2 flip (Option β), or AFTER (Option α)?

## Consideration 1 — User-facing impact of the flip itself

The flip is the user-visible event. v2's storefront-impact difference vs v1:
- **v2 has richer pipeline:** semantic similarity (Stage 2 pgvector cosine over Voyage embeddings), multi-axis ranking (Stage 3 occasion/fit/color/body_type rerankers), real variant data (Stage 5.5 variant-load + Stage 6 binary `available`), diversity selection (Stage 5 MMR + soft quotas), whyTrace + finalScore for trace audit.
- **v1 is the legacy chat tool stub:** simpler nearest-neighbor over embedded products, no rerank stages, no diversity quotas, no whyTrace.

The flip ships the pipeline architecture to users. Even at R3.0 = 0.2917 baseline, the v2 pipeline IS a richer experience than v1 — the eval baseline measures FIXTURE quality, not real-merchant-query quality. Real users typing realistic queries get more on-target recommendations from v2's semantic + reranked + diverse selection than from v1's plain nearest-neighbor.

**The flip has positive user-facing value at R3.0=0.2917 already.** Delaying the flip for a ranking-gap fix means delaying that user-facing value by however long d.2-strict + (c-future) takes to implement and verify.

## Consideration 2 — Eval baseline at flip time

Option α flips at R3.0 = 0.2917 (current baseline). The R3.1 target is "no regression from R3.0" — empirically defined as the post-flip eval being within ±some tolerance of 0.2917.

Option β flips at R3.1 = 0.7+ (the d.2-strict prediction from artifact 18). The R3.1 target becomes "the post-fix-and-flip eval baseline," and the flip's no-regression is verified against that newer, higher baseline.

The eval baseline at flip time matters for:
1. **Diagnostic separability.** If the flip ships at R3.0 (Option α), any eval movement post-flip is attributable to the flip itself + production traffic. If the flip ships at R3.1 (Option β), the movement is harder to disentangle: was it the fix? The flip? Some interaction?
2. **Confidence in v2 quality.** A v2 baseline of 0.2917 means "1 of 4 fixture queries pass." A v2 baseline of 0.7+ means "70%+ of fixture queries pass." The latter is more defensible as "ready for production traffic" if a real-merchant query approximates the fixture distribution.
3. **Operational rollback discipline.** Option α's R3.1 = 0.2917 floor is easier to verify against (the flip succeeds if eval doesn't regress; it fails if eval drops below). Option β's R3.1 = 0.7+ floor is similar in shape but requires both the fix AND the flip to land without regression.

Option α is **diagnostically cleaner.** Option β is **higher-confidence at flip-time.**

## Consideration 3 — Reversibility

The flip is a 3-edit registry change per Thread 1's findings (`app/lib/chat/tools/registry.server.ts:75-78`). It's trivially reversible — one commit to flip, one commit to flip back.

d.2-strict is more entangled: ~50 LOC in Stage 1, updates to Stage 1 unit tests, possibly extractor coupling (depending on how the predicate handles axes not in queryAttributes). Its reversibility is moderate.

(c-future) is process-only; reversal is "ignore the process going forward."

**Reversibility scenarios:**

- **Option β: ship d.2-strict + (c-future) before the flip.** If d.2-strict surfaces an unanticipated regression (real-merchant queries hit empty-Stage-1 due to extractor-axis coupling), rolling back d.2-strict is the same shape as the flip rollback: revert the commit. The flip is independent. Two commits, two rollbacks.
- **Option α: ship the flip first, then d.2-strict + (c-future) in a follow-up.** If the flip surfaces a regression, revert one commit. If d.2-strict later surfaces a regression, revert one more commit. Same overall complexity but independent rollback paths.

Both options are reversible at single-commit granularity. The difference is whether they're shipped as a sequence of two independent commits (α) or as a coupled sub-bundle (β).

The 3.1.6 + 3.1.7 cadence has consistently shipped fix + verification as separate commits (mech.N + mech.N.5). The mech-prompt structure is designed for this. Either α or β fits the cadence.

## Consideration 4 — Sub-bundle scope discipline

3.1.8 was framed at the 3.1.7 close as: "the v1→v2 flip (per planning Section 6 line 156), plus whatever subset of #43/#45/#46/#49/#51 the planning round decides is prerequisite, plus a decision on the (a)/(b)/(c) fork for the ranking-vs-tag-completeness gap."

Option β makes the ranking-gap fix a 3.1.8 mech (mech.0 or mech.1; the flip follows as mech.N). Option α makes the ranking-gap fix a 3.2 mech, with 3.1.8 = flip-only (plus possibly some op-debt closures from #43/#45/#46/#49/#51).

The scope difference:
- **3.1.8-α:** ~1-3 mechs (flip + selective op-debt closure). Small sub-bundle.
- **3.1.8-β:** ~3-5 mechs (d.2-strict, d.2-strict.5 verification, c-future as HANDOFF amendment, flip, flip.5 verification, possibly c-now as a tagging mech).

The 3.1.7 sub-bundle had 4 mechs + 1 conditional skip + close = roughly 5 mechs. 3.1.8-β at 3-5 mechs is similar in scope.

3.1.8-α at 1-3 mechs is smaller; this matches the "the flip is small" original 3.1.7 framing. But the flip's user-facing event needs careful verification (Phase 5 multi-mode, prod chat traffic verification, etc.), so even α likely needs 2-3 mechs of verification work.

**Both options are within reasonable sub-bundle scope.** β is on the larger end of the cadence pattern.

## Consideration 5 — Order-of-operations: catalog data quality vs production routing

Real-merchant queries (post-flip) hit v2 with whatever catalog state exists. If the catalog is sparse on secondary axes (as today), v2's pipeline gracefully degrades to "category-only matches with weak ranking." Users see results, but they're not deeply on-target.

After (c-future) + (c-now) catalog-tagging work, v2's pipeline starts producing richer results because the input data is denser. The flip's user-facing value is therefore higher AFTER catalog data improves.

If the flip ships at α: users get v2 against today's sparse-secondary-axis catalog. v2 is still better than v1 (per Consideration 1), but it's not at its full potential.
If the flip ships at β: users get v2 against the post-d.2-strict + post-(c-future) catalog. v2 is closer to its potential — but the catalog improvement work in (c-now) is separate from d.2-strict + (c-future) and could span 3.1.8-Phase 4.

**β-with-d.2-strict-only** (no c-now): catalog stays sparse, but d.2-strict ensures Stage 1 returns only candidates that pass the secondary-axis filter. Eval lifts to 0.7+ because fixtures that depend on secondary-axis matching now see only the satisfying-subset of Stage 1. Real-merchant query behavior: thin result sets for queries that don't match the (small) secondary-axis-tagged pool.

**α + ship-fix-in-3.2**: catalog stays sparse, v2 ships against current data, real-merchant queries get whatever v2's pipeline produces with the current data. Eval stays at 0.2917 until 3.2 lands d.2-strict.

The d.2-strict shape itself creates the "thin result set" risk that Option β must accept. The risk is mitigated by extractor quality and the d.2-relaxed fallback. The question is whether real-merchant queries on the dev shop produce empty Stage 1 results often enough that user-facing UX is hurt.

This is a question that can be answered empirically only by SHIPPING d.2-strict and watching production chat traffic. The eval harness is a poor proxy for real-merchant query distribution (12 fixtures vs hundreds of real queries per day).

## Recommendation: Option α (flip first, fix in 3.2)

**The flip ships at R3.0 = 0.2917 in 3.1.8. d.2-strict + (c-future) + (c-now) ship in 3.2.**

Rationale:

1. **The flip's user-facing value is positive even at R3.0.** v2 is structurally richer than v1; users benefit from semantic similarity + reranking + diversity even when secondary-axis coverage is thin. Delaying for d.2-strict adds 3-5 weeks (estimate) without proportional user-facing gain.
2. **Diagnostic separability is preserved.** Option α ships the flip and the fix as independent commits, allowing eval delta attribution to each separately. Option β couples them; if eval moves from 0.2917 to 0.75, the attribution between "d.2-strict eval lift" and "flip artifact" is ambiguous.
3. **Real-merchant traffic IS the right test data for d.2-strict's empty-Stage-1 risk.** Shipping the flip first lets real-merchant queries surface where d.2-strict would produce thin result sets. The 3.2 planning round can then design d.2-strict's parameterization (strict vs relaxed; which axes to gate on) against empirical query distribution data, not eval-fixture data.
4. **3.1.8 scope stays disciplined.** α is 1-3 mechs (flip + verification + selective op-debt closures); β is 3-5 mechs. The 3.1.7 sub-bundle was already on the larger end of the cadence; 3.1.8-α restores the smaller-sub-bundle pattern.
5. **Reversibility is independent.** α's flip is one trivial revert if needed; β's coupling means a regression's source is ambiguous before revert.

Trade-off accepted: R3.1 stays at 0.2917 across 3.1.8. The fix work is deferred to 3.2 (eval re-lift) + Phase 4-5 (c-now retroactive tagging + portal-UI gate).

This recommendation is **counter to my pre-investigation prediction** (which was Option β based on the HANDOFF amendment's "R3.1 = 0.3333+ target" implication). The probe evidence (artifact 13, 15) reframed the fork: the original (a)/(b)/(c) framing produces little eval recovery; only the (d.2) shape outside the original framing produces step-change eval recovery; that step-change comes with non-trivial empty-Stage-1 risk that real-merchant traffic is the best way to assess.

Option α preserves optionality: ship the flip now at known-good R3.0; 3.2 designs the right fix shape against production-traffic data.

## What if the planning round prefers Option β anyway?

The planning round has the prerogative to override Thread 3's recommendation. If the planning round chooses Option β:

- **Mech decomposition:** 
  - 3.1.8-mech.1: d.2-strict implementation in Stage 1.
  - 3.1.8-mech.1.5: verification probe (re-run probe-fixture-inventory + eval).
  - 3.1.8-mech.2: (c-future) HANDOFF amendment + planning-round-discipline op-debt entry.
  - 3.1.8-mech.3: v1→v2 flip (registry edit) + legacy tool deletion.
  - 3.1.8-mech.3.5: verification of flip (probe + dev-shop chat smoke test).
  - 3.1.8-mech.4 (optional): (c-now) one-shot retroactive fit-tagging on kurta pool.
  - 3.1.8-mech.5 (close): R3.1 re-anchor against new baseline.
- **R3.1 target:** ≥0.70 (mech.1 expected eval baseline).
- **Risk to manage:** d.2-strict's empty-Stage-1 risk on real merchant queries. Mitigation: ship d.2-strict + (c-future) but DON'T retire d.2-relaxed as a fallback; orchestrator picks d.2-relaxed when d.2-strict returns 0 Stage 1 candidates.

Option β is shippable but the recommendation prefers α.

## Locked decisions output for the planning-round close

| Decision | Recommended answer | Source |
|---|---|---|
| Primary 3.1.8 fix for ranking gap | NONE in 3.1.8 (defer to 3.2). Optionally (c-future) discipline + HANDOFF op-debt entry (free, no LOC). | Artifact 18 + this artifact |
| Flip ordering | Option α (flip first; ranking-gap fix in 3.2) | This artifact § "Recommendation" |
| R3.1 target | 0.2917 (no regression from R3.0). | Aligned with α |
| (a)/(b)/(c) fork resolution | All three insufficient as standalone fixes. (a) null; (b) marginal +0.028; (c) policy-only. Right fix is d.2-strict in 3.2. | Artifacts 14, 15, 16, 17, 18 |
| Mech decomposition for 3.1.8 (preliminary) | ~2-3 mechs: flip (mech.1), verification (mech.1.5), close (mech.2). Plus possibly some op-debt closures from #43/#45/#46/#49/#51 depending on Thread 2 triage. | Aligned with α |
