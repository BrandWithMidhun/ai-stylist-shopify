# Artifact 29 — Op debt #55 assessment: deferred architectural finding (Option α acceptance)

## 1. Verbatim re-pull (Thread 3 artifact 20 § 7, candidate op debt #55)

> #55 (conditional on Option α): Deferred architectural finding becomes an op debt. The (a)/(b)/(c) fork resolves to "defer to 3.2 + d.2-strict implementation." Thread 3 recommended Option α. If the planning round accepts, the op debt records: "Ranking-vs-tag-completeness gap deferred to 3.2; primary fix shape is d.2-strict + (c-future) per artifact 18 § conclusion. Empty-Stage-1 risk on real merchant queries must be measured against production traffic post-flip before d.2-strict parameterization is locked." **Priority: High.** Carries the architectural finding forward.

## 2. Current empirical state

No probe needed; #55 is the carry-forward of Thread 3's deferred architectural decision. The empirical state is exactly what Thread 3 captured:

- Stage 2's `candidatePoolSize=50` narrowing drops tag-complete candidates from 3 fixtures (kurta, going-out, wedding-reception).
- Thread 3's preferred fix (d.2-strict + (c-future)) was deferred to 3.2 (Option α flip-first).
- d.2-strict's empty-Stage-1 risk on real-merchant queries has not been measured against production traffic.

Re-confirmation: artifacts 12, 13, 14, 15, 18, 19 in this thread cluster collectively document the finding.

## 3. Scope estimate — what closing this debt requires

#55 closure = implementing d.2-strict + (c-future) per Thread 3 artifact 18 conclusion:

- **d.2-strict:** Stage 1 secondary-axis hard filter on extracted query axes. ~50 LOC + 3-5 tests. Medium scope.
- **(c-future):** HANDOFF op-debt entry + planning-round-checklist item. 0 LOC code; ~30 LOC of HANDOFF doc.
- **Verification probe:** re-run `_probe-fixture-inventory.ts` post-d.2-strict to confirm aggregateScore lift. ~30 LOC probe.
- **R3 re-anchor:** R3.0/R3.1/R3.2 updated against new baseline (also depends on #54 outcome).
- **Production traffic measurement:** post-flip, post-#55-implementation, monitor real-merchant queries for empty-Stage-1 rate. Operational; not code.

Total scope: ~85 LOC across 3 files + doc + verification. Medium mech.

## 4. Implementation surface

Per Thread 3 artifact 18 conclusion + artifact 27 (#53 assessment):
- **`app/lib/recommendations/v2/stage-1-hard-filters.server.ts`** — primary site.
- **`app/lib/recommendations/v2/pipeline.server.ts`** — plumbing of extracted queryAttributes into Stage 1.
- **Stage 1 unit tests.**
- **HANDOFF.md** — (c-future) policy entry + decision register.

## 5. Eval movement prediction

Per Thread 3 artifact 18: **+0.45 aggregate** (0.2917 → ~0.75). Under K-based denominator semantics (if #54 ships), the prediction is bounded slightly lower because some recovered fixtures may have stage5Count < 6 returns.

Concrete trajectory (current denominator semantics):
- 3 STAGE_2_NARROWING fixtures recover from 0 to ~1.0 each: kurta (Stage 1 → 1 satisfying candidate; 1/1 = 1.0), going-out (Stage 1 → 16 → top-6 satisfying; 6/6 = 1.0), wedding-reception (Stage 1 → 15 → top-6 satisfying; 6/6 = 1.0).
- 3 PARTIAL_RECOVERY fixtures recover from 0.167 to ~1.0 each: linen-shirts, minimalist-daily-wear, oos-stress-1.
- Other fixtures unchanged.

## 6. Coupling to other debts

#55 is the integrator — it pulls together:
- **#53 Stage 2 candidatePool dilution** — d.2-strict is the fix; #53 and #55 share implementation.
- **#46 size_range AI-tagger reliability** — required for d.2-strict's shorts-size-m effectiveness.
- **#49 broader category coverage** — required for d.2-strict's effectiveness on real-merchant queries with arbitrary categories.
- **#51 SEED_RULES divergence** — required for #49's clean implementation.
- **#52 Stage 5 rerank-aware iteration** — orthogonal alternative to d.2-strict (d.4 shape). Mostly mutually exclusive with #55's fix path.
- **#54 relaxedMatchAtK denominator** — affects the predicted R3 ladder values post-#55.

**The entire 3.2 ranking-architecture + catalog-data cluster reduces to #55's implementation + supporting work.**

## 7. Triage verdict

**(N) next-sub-bundle.**

Reasoning:
- #55 exists as a 3.2 prerequisite by definition. Thread 3's α verdict explicitly placed the fix in 3.2.
- Implementation depends on production-traffic data that 3.1.8 doesn't have access to (the empty-Stage-1 risk measurement).
- The carry-forward is the literal point of this op debt — it records what Thread 3 deferred.

**Why NOT flip-blocking (F):**
- Thread 3 explicitly concluded the flip ships first; #55 ships after. The (F) verdict would reverse Thread 3's α verdict.

**Why NOT bundle-with-flip (B):**
- Scope (~85 LOC + tests + new probe) is too large to absorb into 3.1.8 alongside the flip.
- The empty-Stage-1 risk requires post-flip production traffic to parameterize. Pre-flip implementation is guess-work.

**Why NOT Phase 5+ (P):**
- The fix is Phase 3 (recommendation pipeline) work, not multi-tenant or multi-mode work. 3.2 is the right next sub-bundle.

**Recommendation:** carry to 3.2 as the central concern of the ranking-architecture cluster. Pair sequencing with #46 (size_range), #49 (broader category coverage), #51 (canonical-source decision), and #54 (denominator semantics, if not closed in 3.1.8). #52 (rerank-aware Stage 5) is the structurally-different alternative; the 3.2 planning round picks one.

The op debt itself is durable — it persists in HANDOFF.md until the 3.2 (or later) close commit lands the implementation.
