# Artifact 20 — Thread 3 synthesis: ranking-gap fork resolution

**Investigation scope:** read-only, 0 source changes on main. Throwaway branch `throwaway/3-1-8-thread-3-fix-a-sim` created for fix (a) eval simulation; branch deleted after eval capture; no commit ever landed on main. Investigation produced 11 durable artifacts (09-19) + this synthesis (20).

## Section 1 — Restated problem

The 3.1.7 mech.4 verification surfaced a regression: aggregateScore dropped from 0.3333 (mech.3.5) to 0.2917 (post-mech.4) because the `fashion-oversized-fit-kurta` fixture regressed PARTIAL (0.50) → FAIL (0). The mech.4.5 analysis attributed this to "broader category coverage HURT eval when secondary-axis (fit) coverage didn't scale proportionally."

The HANDOFF amendment named this finding the **ranking-vs-tag-completeness gap** and enumerated three potential fixes (HANDOFF lines 816-820):

- **(a)** Stage 3 rerank tag-overlap signal.
- **(b)** Stage 5 quota policy for per-fixture-axis-coverage.
- **(c)** Proportional coverage discipline.

The 3.1.7 close deferred the resolution to the 3.1.8 planning round, framing the fork as Option α (ship flip without addressing the gap, R3.1 = 0.2917) vs Option β (fix the gap before flip, R3.1 = 0.3333+).

Thread 3's job: resolve the fork (or surface a fix (d) shape if evidence calls for it), determine whether the fix is a 3.1.8 prerequisite or 3.2+ work, produce the locked-decisions input for the planning-round close.

**Why this fork matters for 3.1.8:** the v1→v2 flip is the 3.1.8 anchor work. The fork determines whether R3.1 is "no regression from R3.0=0.2917" (α — flip ships against current baseline) or "step-change improvement to 0.33+" (β — flip ships against fixed baseline). The locked decision shapes 3.1.8's scope and the eval ladder Phase 3-4 measures against.

The (a)/(b)/(c) framing is the right starting point — it captures the three most-obvious fix sites (Stage 3, Stage 5, process). But the investigation will show it's not the complete enumeration. Probe evidence surfaced a Stage 2 narrowing bottleneck the original framing missed, which led to fix (d) shapes that dominate (a)/(b)/(c) on multiple dimensions.

## Section 2 — Premise checks

For each candidate fix, the structural soundness check is: "does the fix operate at the right point in the pipeline to address the bottleneck identified by the probe data?"

### (a) Stage 3 rerank tag-overlap signal
**Premise (from HANDOFF):** "Add an explicit weight to Stage 3's rerank for 'how many of the query's extracted attributes does this candidate's APPROVED tag set satisfy?'"
**Soundness check:** Stage 3 attaches `rerankBoosts` but does NOT reorder candidates. Stage 5 iterates Stage 4 input in similarity-distance order (preserved through Stage 3+4); rerankBoosts feed Stage 6 finalScore only, AFTER Stage 5 has already selected its top-K. **Premise is structurally insufficient.** Confirmed empirically by artifact 14: fix (a) eval delta = 0 across every fixture.

### (b) Stage 5 axis-coverage quota
**Premise (from HANDOFF):** "Add a per-fixture-axis-coverage quota so the top-K must include at least N cards satisfying the per-axis filter (when feasible from the candidate pool)."
**Soundness check:** Stage 5's `skipped` set contains candidates rejected by first-pass quota/MMR. Fix (b) promotes axis-satisfying candidates from `skipped`. **Sound IF the satisfying candidates are in Stage 2's top-50 pool to begin with.** Probe (artifact 13) shows 3 fixtures (kurta, going-out-outfit, wedding-reception) have ZERO satisfying candidates in Stage 2's pool. Fix (b) is a no-op on those. Helps only 2 fixtures (linen-shirts, oos-stress-1) by ~+0.028 aggregate.

### (c) Proportional coverage discipline
**Premise (from HANDOFF):** "Treat secondary-axis coverage as a prerequisite for category coverage expansion. mech.4's lesson: don't add 200 kurta rows without also adding fit tags to those 200 products."
**Soundness check:** (c) is a forward-looking process discipline, not an eval-recovery fix. It addresses the DATA cause (sparse secondary-axis tagging), not the RANKING symptom. Sound as policy; 0 eval recovery on the existing kurta regression.

### (d.1) Hybrid (a) + (c)
**Soundness check:** (a) is structurally insufficient (Stage 5 ignores rerankBoosts in selection). Bundling (a) with (c) doesn't fix (a). Reduces to (c) alone with extra LOC.

### (d.2) Stage 1 secondary-axis hard filter (the emerged shape)
**Premise:** "When extracted queryAttributes includes a non-category axis (fit, color, occasion, season, etc.), Stage 1 hard-filters to candidates with APPROVED `<axis>` (any value, or matching value)."
**Soundness check:** addresses the bottleneck at its source. The kurta regression is caused by Stage 1 returning 202 candidates (only 1 satisfying both fixture axes) followed by Stage 2's top-50 narrowing dropping the 1 satisfying. (d.2) makes Stage 1 return only candidates with APPROVED secondary axis, so dilution is impossible by construction. **Premise structurally sound.** Predicted eval recovery: +0.45 aggregate (artifact 18).

### (d.3) Stage 2 tag-completeness weighting
**Soundness check:** addresses the bottleneck location (Stage 2 narrowing) but conflates semantic-similarity and tag-completeness in a single stage. Sound but architecturally messier than (d.2).

### (d.4) Stage 5 rerank-aware iteration order
**Soundness check:** changes Stage 5 to iterate by Stage 4 score (similarity + rerankBoosts + merchantBoost) instead of Stage 2's similarity order. Makes Stage 3 reranks selection-effective rather than display-only. Sound but doesn't address the upstream Stage 2 bottleneck.

## Section 3 — Recommended fix

**Recommended fix: NONE in 3.1.8.** The ranking-gap fix (whatever shape) ships in 3.2, NOT 3.1.8. Optionally pair with (c-future) — proportional coverage discipline as a HANDOFF op-debt entry + planning-round-checklist item — in 3.1.8 as a free (zero-LOC) addition.

The right fix when 3.2 lands: **d.2-strict + (c-future)** per artifact 18 § conclusion.

### Rationale (Option C-folded shape, mirroring 3.1.7 Thread 3 § 3)

The recommendation is structurally the same shape as the 3.1.7 Thread 3 "Option C-folded": **a recommendation derived from probe evidence rather than from the original framing's enumeration.** The 3.1.7 precedent was that the right answer wasn't in the original (A, B.i, B.ii-bundled, D-alone, E-alone) enumeration — it was a synthesis (Option C-folded = "ship 3.1.7 universe correction; defer 3.1.8 flip; pair with bulk-approve secondary axes + vocabulary expansion").

The current Thread 3 finding: **the right answer isn't in the (a)/(b)/(c) enumeration either.** It's d.2-strict + (c-future), or equivalently a deferral-to-3.2 (Option α from artifact 19) that frames 3.1.8 as flip-only and 3.2 as the d.2-strict + (c-future) implementation sub-bundle.

The deferral is justified by:

1. **Empirical null on (a):** artifact 14/15 confirms (a) has 0 eval impact.
2. **Marginal value on (b):** +0.028 aggregate on 2 fixtures (linen-shirts, oos-stress-1). Not worth the ~80 LOC + Stage 5 contract change at 3.1.8 timing.
3. **Forward-only value on (c):** doesn't recover existing regression. Free as a process item; not a 3.1.8 mech.
4. **d.2-strict's empty-Stage-1 risk is best assessed against real production traffic.** Shipping d.2-strict before the flip would be guess-work; shipping it after the flip lets real-merchant query distribution inform parameterization.
5. **Diagnostic separability.** Coupling flip + fix in one sub-bundle creates attribution complexity. Sequential commits in α preserve separable rollback paths.

### Comparison to alternatives

| Option | aggregateScore @ flip | Code surface in 3.1.8 | 3.1.8 scope | Recovery on kurta | Reversibility |
|---|---:|---|---|---|---|
| Ship (a) | 0.2917 (null) | ~25 LOC | small | No | One-line |
| Ship (b) | 0.3194 | ~80 LOC | medium | No | Stage 5 contract change |
| Ship (c-future) | 0.2917 | 0 LOC | small | No (forward) | Trivial (process) |
| Ship d.2-strict | ~0.75 | ~50 LOC | medium | Yes | Moderate |
| Ship (a)+(b)+(c-future) | 0.3194 | ~110 LOC | medium | No | Multi-surface |
| **DEFER to 3.2** (recommended) | **0.2917** | **0 LOC** | **small** | **No (now); Yes (3.2)** | **N/A** |

### Trade-offs accepted

- R3.1 = 0.2917 (no improvement from R3.0). 3.1.8's flip ships against the current eval baseline. The eval lift to ~0.75 waits for 3.2.
- The architectural finding stays an open op-debt; it does not get a HANDOFF-amendment closure in 3.1.8 beyond the (c-future) policy entry.
- 3.2's scope expands: it absorbs d.2-strict implementation (~50 LOC) + verification (~30 LOC probe) + R3.1-or-R3.2 re-anchor.

## Section 4 — Flip ordering recommendation

**Recommended ordering: Option α (flip first, ranking-gap fix in 3.2).**

Cite: artifact 19 § "Recommendation: Option α." The load-bearing considerations:

1. The flip's user-facing value is positive at R3.0=0.2917 (v2 is structurally richer than v1; users benefit even with thin secondary-axis coverage).
2. Diagnostic separability preserved (flip and fix as independent commits).
3. Real-merchant query traffic is the right test data for d.2-strict's empty-Stage-1 risk; production traffic must precede d.2-strict design.
4. 3.1.8 scope stays small (~1-3 mechs vs β's 3-5 mechs).
5. Reversibility is independent.

## Section 5 — Mech decomposition (preliminary)

If the planning round accepts Thread 3's recommendation (Option α + defer fix to 3.2):

| Mech | Scope | LOC | Test surface |
|---|---|---:|---|
| **3.1.8-mech.1: v1→v2 flip** | Edit `app/lib/chat/tools/registry.server.ts` to swap v1 tool registration for v2 (~3 logical edits per Thread 1 artifact `02`). | ~8 LOC | 1-2 chat-agent integration test updates |
| **3.1.8-mech.1.5: Flip verification artifact** | Re-confirm Thread 1's surface-parity findings against current main (~probe + dev-shop chat smoke test). | ~30 LOC probe | None |
| **3.1.8-mech.2: Legacy v1 tool deletion** | Delete `app/lib/chat/tools/recommend-products.server.ts` and its tests; clean up imports. | ~-200 LOC (deletion) | Remove v1 tests |
| **3.1.8-mech.3 (close):** HANDOFF amendment + (c-future) policy entry + sub-bundle close | ~40 LOC of HANDOFF text | Free | None |

**Mech count: 3 + 1 verification = ~4 mechs.** Plus possible prerequisite-closure mechs from Thread 2's triage (op debts #43/#45/#46/#49/#51 — Thread 2 has not yet run; the prerequisite list is still candidate-only).

**This is preliminary** because Thread 2's prerequisite triage may bundle op-debt closures (e.g., #51 dev-shop-rule-table-reconciliation) with the flip work, expanding 3.1.8's mech count to 5-6. The final mech decomposition lands at the planning-round close after Thread 2 lands.

If the planning round instead chooses Option β (ship d.2-strict + flip in 3.1.8):

| Mech | Scope | LOC | Test surface |
|---|---|---:|---|
| **3.1.8-mech.1: d.2-strict** | Stage 1 secondary-axis hard filter; pipeline orchestrator passes queryAttributes axes to Stage 1. | ~50 LOC | 3-5 Stage 1 unit test additions |
| **3.1.8-mech.1.5: d.2 verification artifact** | Re-run probe-fixture-inventory + eval. Confirm aggregateScore lift to ~0.7. | ~30 LOC probe + eval rerun | None |
| **3.1.8-mech.2: HANDOFF (c-future) entry** | Process item + op-debt amendment | 0 LOC | None |
| **3.1.8-mech.3: v1→v2 flip** | Registry edit | ~8 LOC | 1-2 integration tests |
| **3.1.8-mech.3.5: Flip verification** | Probe + dev-shop chat smoke | ~30 LOC | None |
| **3.1.8-mech.4 (optional): (c-now) retroactive fit-tagging on kurta pool** | Bulk-approve helper run | 0 LOC source | None |
| **3.1.8-mech.5 (close):** R3.1 re-anchor at new baseline ≥0.70 | HANDOFF text | 0 LOC | None |

**Mech count: 5 + 2 verifications = ~7 mechs.** Larger than 3.1.7's 5-mech cadence.

## Section 6 — Open questions for planning-round close

These decisions are deferred to the planning-round close (after Thread 2 also lands):

1. **Whether the chosen fix's mech is in 3.1.8 scope or 3.2 scope.** Thread 3 recommends 3.2 (Option α). The planning-round close adjudicates between α and β.
2. **Whether Thread 2 surfaces prerequisite closures that bundle with the flip.** Op debts #43 (gender=female 0% APPROVED), #45 (Stage 6 binary vs Stage 3 weighting on availability), #46 (size_range AI-tagger reliability), #49 (broader category coverage), #51 (SEED_RULES vs dev-shop TaggingRule divergence). Thread 2's triage will identify which are 3.1.8 prerequisites vs 3.2 carry-forwards.
3. **Final R3.1 target value.** 0.2917 if α; 0.70+ if β (per d.2-strict prediction). Locks at planning-round close.
4. **Whether (c-future) ships in 3.1.8 close or 3.2 open.** (c-future) is zero-LOC. Cheap to include in 3.1.8 close as a HANDOFF amendment, regardless of α/β choice on the main fix. Lean: include in 3.1.8 close.
5. **Whether (c-now) — retroactive fit-tagging on the kurta pool — is its own 3.1.8 mech.** Depends on R3.1 target value. If 0.2917, (c-now) is irrelevant for 3.1.8. If 0.50 (intermediate target between α and β), (c-now) is the cheapest path to lift the kurta fixture toward PARTIAL.

## Section 7 — Op debts surfaced by Thread 3 alone

Candidate op debts for the planning-round close (numbering picks up at #52 since Thread 1 surfaced none):

- **#52 — Stage 5 ignores rerankBoosts in selection-eligibility decisions.** Stage 5 iterates Stage 4 input in similarity-distance order (preserved through Stage 3+4). The rerankBoosts attached by Stage 3 feed Stage 6 finalScore only; they do NOT affect Stage 5's top-K selection. Artifact 10 + 15 documents this. Implication: existing FASHION rerankers (occasion, fit, color, body_type) influence display ordering but not which candidates make top-K. Future Stage 3 rerank work must be paired with a Stage 5 change (e.g., (d.4) rerank-aware iteration order) for the rerank to be selection-effective. **Priority: Medium.** Re-visit at 3.2 planning round if d.4-style architecture is preferred over d.2.

- **#53 — Stage 2 candidatePool=50 caps narrowing dilution.** When Stage 1's pool size exceeds 50, Stage 2's narrowing can drop tag-complete candidates that don't rank in the top-50 by pure semantic similarity. The 3 fixtures (kurta, going-out, wedding-reception) all hit this bottleneck (1000 → 50 narrowing drops 15-16 satisfying candidates each). Possible mitigations: raise pool size, weight Stage 2 by tag-completeness (d.3), or move the filter upstream (d.2-strict). **Priority: High.** Load-bearing for 3.2 fix design.

- **#54 — `relaxedMatchAtK` denominator semantics make small-pool fixtures structurally favored.** `relaxedMatchAtK` (in `app/lib/recommendations/v2/eval/scoring.ts:91`) normalizes by `Math.max(1, top.length)` rather than by K. Pre-mech.4 kurta scored 1/2=0.50 PARTIAL because Stage 1 returned only 2 candidates. Post-mech.4 kurta with the same single satisfying card would max at 1/6=0.167 FAIL. The pre-mech.4 0.3333 baseline is therefore not architecturally recoverable from any code-side fix unless catalog data grows or scoring policy changes (max with K instead of returned-count). **Priority: Medium.** Surface to planning-round-close decision: do we keep current normalization or switch to K-based?

- **#55 (conditional on Option α):** Deferred architectural finding becomes an op debt. The (a)/(b)/(c) fork resolves to "defer to 3.2 + d.2-strict implementation." Thread 3 recommended Option α. If the planning round accepts, the op debt records: "Ranking-vs-tag-completeness gap deferred to 3.2; primary fix shape is d.2-strict + (c-future) per artifact 18 § conclusion. Empty-Stage-1 risk on real merchant queries must be measured against production traffic post-flip before d.2-strict parameterization is locked." **Priority: High.** Carries the architectural finding forward.

These are CANDIDATES. They become real op debts when the planning-round close lands them with the locked decomposition.

## Section 8 — Predictions vs reality

Pre-investigation predictions (from the Thread 3 spec):

1. **Fix (a) recovers the kurta fixture.** ❌ **Wrong.** Empirical eval (artifact 14) shows aggregateScore 0.2917 → 0.2917, every fixture unchanged. The architectural premise check (artifact 10 annotation) caught this before the simulation: Stage 5 iterates in similarity order, ignoring rerankBoosts in selection. Simulation confirmed.

2. **Fix (a) is the right architectural choice.** ❌ **Wrong.** Fix (a) is structurally insufficient because the bottleneck is at Stage 2 narrowing, not at Stage 3 rerank. The probe data (artifact 12, 13) shows 3 fixtures hit STAGE_2_NARROWING_DROPS_SATISFYING. The right architectural choice is upstream of Stage 3 — d.2-strict (Stage 1 hard filter) or d.3 (Stage 2 weighting). d.2 dominates d.3 on cleanliness.

3. **Option β is the right flip ordering.** ❌ **Wrong.** Investigation findings reframed this:
   - The original (a)/(b)/(c) framing produces little eval recovery; only (d.2) produces step-change recovery; that step-change comes with non-trivial empty-Stage-1 risk.
   - Real-merchant traffic is the best test for that risk; production traffic must precede d.2-strict design.
   - Therefore: ship flip first (Option α), measure production traffic, design d.2-strict in 3.2.

All three predictions inverted. The investigation was load-bearing — every prediction was wrong, and the wrong predictions would have led to:
- Shipping a null fix (a) that creates false-positive impression of progress.
- Coupling fix + flip in a sub-bundle that's harder to roll back.
- Pinning R3.1 to a target (0.33+) that the chosen fix can't deliver on its own.

The pre-execution discipline of running the simulation rather than trusting paper-and-pencil reasoning was the correct call. The HANDOFF amendment's framing was a reasonable starting hypothesis; the probe evidence falsified it. Thread 3's investigation produced the load-bearing reframing.

## Section 9 — Locked decisions output for planning-round close

The planning-round close should consider:

| Decision | Thread 3 recommended answer |
|---|---|
| Resolve (a)/(b)/(c)/(d) fork | d.2-strict + (c-future) is the structurally correct fix; defer to 3.2 |
| Flip ordering (α / β) | **α — flip first, fix in 3.2** |
| R3.1 target | 0.2917 (no regression from R3.0); 3.2 will lift to R3.2 ≥0.50 |
| 3.1.8 includes (c-future)? | Yes — zero-LOC HANDOFF amendment + planning-round-checklist item |
| 3.1.8 includes (c-now)? | No (defer to 3.2 as part of d.2-strict's catalog-data-quality companion work) |
| 3.1.8 mech count (preliminary) | 3 mechs + 1 verification + 1 close = ~5 mechs total (after Thread 2 triage adds prerequisite closures) |
| Op debts added at planning-round close | #52, #53, #54, #55 per Section 7 |

## Section 10 — References

- **Investigation artifacts (this thread, `.pr-3-1-8-planning-artifacts/`):**
  - `09-stage-3-rerank-current.txt` — Stage 3 source surface + annotation (load-bearing premise check: Stage 5 ignores rerankBoosts in selection).
  - `10-stage-5-diversity-current.txt` — Stage 5 source surface + annotation (selection-by-similarity-order).
  - `11-kurta-fixture-verbatim.txt` — fixture verbatim + expected behavior.
  - `12-kurta-candidate-pool.json` — probe output: Stage 1 (202 candidates, 2 fit-tagged) → Stage 2 (50 in pool, 1 fit-tagged at rank 24) → Stage 5 (top-6 with fit-regular at pos 2; 0 satisfying).
  - `12-kurta-candidate-pool-annotation.md` — load-bearing finding: the only fit=relaxed kurta product (cmoeelkxq...) doesn't survive Stage 2 narrowing.
  - `_probe-kurta-candidates.ts` — probe script.
  - `_probe-kurta-fit-detail.ts` — auxiliary probe (kurta fit-value mapping + catalog-wide oversized/relaxed count).
  - `13-fixture-ranking-gap-affected.md` — per-fixture inventory; identifies 3 STAGE_2_NARROWING fixtures (kurta, going-out, wedding-reception).
  - `_probe-fixture-inventory.ts` — probe script for fixture inventory.
  - `_fixture-inventory.json` — probe output for all 12 fixtures.
  - `14-fix-a-eval-result.txt` — empirical eval with fix (a) active: aggregateScore 0.2917 (no change).
  - `15-fix-a-simulation-analysis.md` — analysis: null result confirms architectural reading.
  - `16-fix-b-analysis.md` — paper-and-pencil: marginal +0.028 with MIN=2; doesn't help kurta/going-out/wedding-reception.
  - `17-fix-c-analysis.md` — policy analysis: forward-only; pair with c-now for retroactive recovery.
  - `18-fix-d-shapes-analysis.md` — d.1-d.4 shapes; recommends d.2-strict + (c-future).
  - `19-flip-ordering-analysis.md` — α vs β analysis; recommends α.

- **3.1.7 close artifacts (referenced):**
  - `docs/planning/3-1-7-post-eval-pass-flip.md` — locked-decisions table (referenced for the Option-C-folded precedent shape).
  - `.pr-3-1-7-mech-4-artifacts/07-mech-4-verification-analysis.md` — the original architectural finding writeup.

- **Source files exercised:**
  - `app/lib/recommendations/v2/stage-1-hard-filters.server.ts` (read; d.2-strict modification site)
  - `app/lib/recommendations/v2/stage-2-semantic-retrieval.server.ts` (read; bottleneck location)
  - `app/lib/recommendations/v2/stage-3-rerank/index.server.ts` (read)
  - `app/lib/recommendations/v2/stage-3-rerank/fashion.server.ts` (read; fix (a) temporarily modified on throwaway branch)
  - `app/lib/recommendations/v2/stage-3-rerank/query-extraction.server.ts` (read; extractor coupling for d.2)
  - `app/lib/recommendations/v2/stage-4-merchant-signals.server.ts` (read)
  - `app/lib/recommendations/v2/stage-5-diversity.server.ts` (read; fix (b) modification site)
  - `app/lib/recommendations/v2/stage-6-output.server.ts` (read)
  - `app/lib/recommendations/v2/pipeline.server.ts` (read; for runPipeline composition)
  - `app/lib/recommendations/v2/eval/pipeline-runner.server.ts` (read)
  - `app/lib/recommendations/v2/eval/scoring.ts` (read; relaxedMatchAtK denominator semantics)

- **Empirical proof points:**
  - aggregateScore (baseline post-mech.4) = 0.2917 (EvalRun cmp1dlvil...)
  - aggregateScore (fix (a) sim) = 0.2917 (EvalRun cmp5oynuh...; null delta)
  - Stage 1 = 202 candidates for kurta query (artifact 12)
  - 2 of 202 have APPROVED fit; only fit=relaxed (1 product) satisfies expectedTagFilters
  - fit=relaxed product (cmoeelkxq00zio436pji1ms7o) does NOT survive Stage 2's top-50
  - 3 fixtures hit STAGE_2_NARROWING_DROPS_SATISFYING (artifact 13)
