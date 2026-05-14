# Artifact 32 — Thread 2 synthesis: prerequisite triage

**Investigation scope:** read-only, 0 source changes. 9 op debts triaged with per-debt rubric (#43/#45/#46/#49/#51 from 3.1.7 + #52/#53/#54/#55 from Thread 3). 11 durable artifacts produced (21-31) + this synthesis (32) + 2 empirical-state probes (`_probe-catalog-state.ts`, `_probe-rule-state.ts`) with outputs.

## Section 1 — Restated problem

Thread 2's question per Thread 3's verdict reshape: **does each candidate op debt block the v1→v2 flip itself?**

Thread 3 resolved the ranking-gap fork to Option α (flip first; ranking-gap fix in 3.2 via d.2-strict + (c-future)). That verdict dissolved the original "ranking-gap fix prerequisites" framing that drove the 3.1.7-close enumeration of #43/#45/#46/#49/#51 as 3.1.8 candidates. The simplified triage: for each debt, is it flip-blocking (F) / bundle-with-flip (B) / next-sub-bundle (N) / Phase 5+ (P)?

The 9 debts:
- **5 from 3.1.7** (#43 gender axis, #45 in-stock ratio, #46 size_range tagger, #49 category coverage, #51 SEED_RULES divergence).
- **4 from Thread 3** (#52 Stage 5 rerank-aware, #53 Stage 2 narrowing, #54 denominator semantics, #55 deferred architectural finding).

The Thread 2 spec predicted F-empty or-#54-only, B at #43, N for the rest. The investigation confirms the prediction shape with one delta (#43 sticks at N rather than upgrading to B).

## Section 2 — Per-op-debt verdicts

Summary table (full rationale in per-debt artifacts):

| Op debt # | Title | Verdict | Source artifact |
|---|---|---|---|
| #43 | gender=female axis at 0% APPROVED | N (→B if planning round prefers eval-progress) | 21 |
| #45 | in-stock ratio question | N (→P if dependent on multi-shop data) | 22 |
| #46 | size_range AI-tagger reliability | N | 23 |
| #49 | broader category-coverage gap | N | 24 |
| #51 | dev shop SEED_RULES divergence | N (decision direction named at planning close) | 25 |
| #52 | Stage 5 ignores rerankBoosts | N (→P if 3.2 picks d.2-strict alone) | 26 |
| #53 | Stage 2 candidatePool dilution | N | 27 |
| #54 | **relaxedMatchAtK denominator semantics** | **B** | **28** |
| #55 | deferred architectural finding (α) | N | 29 |

**Verdict distribution: F=0 / B=1 / N=8 / P=0.**

## Section 3 — Notable findings

### 3.1 — #54 is the load-bearing surprise

Thread 2's pre-investigation framing assumed triage would be mostly carry-forward. #54's denominator semantics question turned out to be a measurement-contract decision that directly affects whether R3.1's "no regression from R3.0=0.2917" semantic is meaningful.

The empirical finding (artifact 28): `relaxedMatchAtK` normalizes by `Math.max(1, top.length)` rather than by K. This creates a small-pool incentive: a fixture with 2 returned candidates and 1 satisfying scores 0.50 PARTIAL; the same fixture with 6 returned candidates and 1 satisfying scores 0.167 FAIL. **The mech.4 kurta regression was an artifact of this property** — Stage 1 expanding from 2 → 202 candidates inflated the denominator from 2 to 6 (Stage 5 cap), dropping the score by 3× even though the satisfying candidate count stayed at most 1.

The fix is trivial (~15 LOC change in `scoring.ts` + R3 re-anchor in HANDOFF). The decision is non-trivial: keeping current rules vs switching to K-based normalization shifts every fixture's score and re-anchors the R3 ladder.

Thread 2 recommends (B) bundle-with-flip — switch to K-based, re-anchor R3.0 = 0.2778, lock the measurement contract before 3.2 work proceeds. Counter-argument: defer to 3.2 (N) preserves minimum 3.1.8 scope. Both are defensible; the planning-round close decides.

### 3.2 — #51 has a planning-round-decision embedded

The HANDOFF op debt #51 entry names three remediation options for the SEED_RULES.FASHION divergence: (a) update code to match deployed state, (b) reset shop to match code, (c) document divergence as expected feature.

The decision affects Phase 5 multi-tenant onboarding semantics. Option (c) — "SEED_RULES is the starter template, not canonical" — is Thread 2's recommended direction (artifact 25). It's the cleanest model for multi-shop diversity (new merchants get a default starter rule set; they're free to customize via the Phase 5 portal). Options (a) and (b) lock-in either the dev-shop hand-customizations as defaults (bad for diversity) or the codebase defaults (lossy for the current dev shop's data).

The planning-round close should at least NAME a preferred direction — even with implementation deferred to 3.2 — so the 3.2 planning round has a baseline to confirm or override.

## Section 4 — Mech decomposition impact

Per Thread 2's verdict distribution (F=0, B=1):

**Recommended 3.1.8 mech decomposition:**

| Mech | Scope | LOC | Justification |
|---|---|---:|---|
| 3.1.8-mech.1 | #54 denominator switch (K-based normalization) | ~15 LOC + 2 test updates | (B) bundle |
| 3.1.8-mech.2 | v1→v2 flip (registry edit) | ~8 LOC | Anchor work |
| 3.1.8-mech.2.5 | Flip verification probe + dev-shop chat smoke test | ~30 LOC probe | Verification |
| 3.1.8-mech.3 | Legacy v1 tool deletion | ~-200 LOC (deletion) | Cleanup |
| 3.1.8-mech.4 (close) | HANDOFF amendment: re-anchored R3.0/R3.1/R3.2 + (c-future) policy + #51 direction + new op debts #52-#55 | ~50 LOC of doc | Close |

**Total: ~4-5 mechs.** Stays within the 3.1.7 sub-bundle cadence pattern.

**Alternative shape if #54 reverts to N:** drop mech.1. Total: 3-4 mechs. R3 stays at 0.2917 under current rules.

**Alternative shape if #43 upgrades to B (planning round prefers eval-progress signals):** add a mech.X for gender-rule-apply + verification. Total: 5-6 mechs. R3 changes are uncertain (depends on dev-shop product count matching `title_contains "women's"`).

Thread 2's RECOMMENDED shape is the 4-5 mech version with #54 bundle. Thread 3's RECOMMENDED shape was the 3-4 mech version (minimum). The deltas:

- Thread 3: focus on flip; defer everything else.
- Thread 2: agree on flip-focus; recommend +1 mech for #54 because the measurement contract decision is small enough to lock now and prevents future regressions.

The planning-round close picks between these by deciding whether the #54 measurement-contract value is worth +1 mech of scope.

## Section 5 — Coupling notes for 3.2 planning

The 8 N-verdict debts cluster naturally for 3.2 planning:

### Cluster 1 — Ranking-architecture cluster

Debts: **#52, #53, #55** (with #54 if it didn't close in 3.1.8).

These all address Stage 2-5 ranking architecture. Thread 3's recommended primary fix (d.2-strict) directly implements #55 + #53. #52 (rerank-aware Stage 5) is an orthogonal alternative. The 3.2 planning round picks ONE primary fix.

Sequence: #54 first (anchor measurement contract) → #55/#53 (primary fix) → optional #52 if 3.2 keeps d.2-strict shape light.

### Cluster 2 — Catalog-data cluster

Debts: **#46, #49, #51**.

All address tagging quality and canonical-source contracts. #51 unblocks #49; #46 is independent (variant-option extractor).

Sequence: #51 (canonical-source decision) → #49 (more SEED_RULES seeds + apply-rules pass) → #46 (variant-option size extractor).

### Cluster 3 — Deferred decisions cluster

Debts: **#43, #45**.

Both need real-merchant data to resolve. #43 (gender) and #45 (in-stock pathology) are framing-question debts. Phase 5+ territory unless 3.2 has bandwidth.

### 3.2 sub-bundle shape prediction

Two clusters fit a single 3.2 planning round (ranking-architecture + catalog-data ≈ 5-7 mechs combined). Three clusters likely splits across 3.2 and 3.3. Thread 2 recommends 3.2 absorb cluster 1 + cluster 2; cluster 3 carries to 3.3 (or stays open as multi-shop-onboarding work in Phase 5).

## Section 6 — Op debts surfaced by Thread 2 alone

**None.**

Thread 2's investigation produced no new architectural findings warranting their own op debt. The 9 debts triaged were either already known (5 from 3.1.7) or already documented by Thread 3 (4 from Thread 3 artifact 20 § 7).

This is expected: Thread 2 is a TRIAGE thread, not an investigation thread. The work is per-debt assessment using existing evidence + small re-confirmation probes. No new debts surfaced.

## Section 7 — Predictions vs reality

Pre-investigation predictions (from Thread 2 spec):

1. **All five original op debts (#43, #45, #46, #49, #51) are N or P.** ✓ **Correct.** All five are N (some with P-edge qualifiers). No upgrades to F or B except the conditional #43 → B that the planning round can choose.

2. **Of the four new op debts (#52-#55), #54 might surface as more important than triage-routine.** ✓ **Confirmed.** #54 is the only B verdict in the triage. The denominator semantics question turned out to be a measurement-contract decision affecting R3 ladder interpretation — exactly the kind of decision that should be locked deliberately rather than carried indefinitely.

3. **The mech.3.5 peak of 0.3333 finding from #54 is *retroactively load-bearing* for understanding 3.1.7's chain.** ✓ **Confirmed.** Artifact 28's analysis shows the mech.3.5 → mech.4 regression (0.3333 → 0.2917) was structurally caused by the denominator-favors-small-pools property. Under K-based normalization, the kurta fixture's pre-mech.4 0.50 PARTIAL was inflated; the post-mech.4 0.167 FAIL is the "true" score absent the small-pool inflation. The mech.4 regression itself wasn't a real regression in the meaningful sense — both states map to FAIL bucket under K-based.

All three predictions confirmed. Notable deltas:
- #43 stuck at N (the spec predicted possible upgrade to B). The upgrade path is documented for the planning round to elect if eval-progress signals are valuable.
- #45 has a P-edge that the spec didn't anticipate. Multi-shop data dependency might push it past 3.2.
- #51's planning-round-decision-direction (option c — "starter template" framing) is Thread 2's explicit recommendation; the spec named #51 as a decision-bearing debt but didn't pre-name a preferred direction.

## Section 8 — Locked-decisions output for planning-round close

Thread 2's input to the planning-round close:

| Decision | Thread 2 recommended answer |
|---|---|
| Verdict for #43 | N (default), B if planning round prefers eval-progress signals |
| Verdict for #45 | N (preferred) or P |
| Verdict for #46 | N (alongside d.2-strict in 3.2) |
| Verdict for #49 | N (depends on #51 in 3.2) |
| Verdict for #51 | N (with decision direction option c — "starter template" framing — named at planning close) |
| Verdict for #52 | N (or P if 3.2 picks d.2-strict alone) |
| Verdict for #53 | N (the d.2-strict implementation site) |
| Verdict for #54 | **B (bundle-with-flip)** — switch to K-based normalization, re-anchor R3 ladder |
| Verdict for #55 | N (deferred architectural finding by design) |
| 3.1.8 mech count (recommended) | **~4-5 mechs** with #54 bundle |
| HANDOFF amendments in 3.1.8 close | Re-anchored R3.0/R3.1/R3.2 + (c-future) policy + #51 direction + new op debts #52-#55 |

## Section 9 — References

- **Per-debt assessment artifacts (this thread):**
  - `21-op-debt-43-assessment.md` — gender=female axis (N, → B conditional).
  - `22-op-debt-45-assessment.md` — in-stock ratio question (N → P edge).
  - `23-op-debt-46-assessment.md` — size_range AI-tagger reliability (N).
  - `24-op-debt-49-assessment.md` — broader category coverage (N).
  - `25-op-debt-51-assessment.md` — SEED_RULES divergence (N, with direction option c).
  - `26-op-debt-52-assessment.md` — Stage 5 rerank-aware (N → P edge).
  - `27-op-debt-53-assessment.md` — Stage 2 candidatePool dilution (N).
  - `28-op-debt-54-assessment.md` — **relaxedMatchAtK denominator semantics (B — Thread 2 load-bearing finding).**
  - `29-op-debt-55-assessment.md` — deferred architectural finding (N).

- **Cross-cutting artifacts:**
  - `30-coupling-matrix.md` — coupling matrix + 3.2 cluster identification.
  - `31-triage-ranking.md` — verdict distribution + 3.1.8 mech decomposition implication.

- **Empirical-state probes (read-only, no DB writes):**
  - `_probe-catalog-state.ts` + `_catalog-state-output.txt` — re-confirms #43/#45/#46/#49 state hasn't drifted since 3.1.7 mech.X.5 captures.
  - `_probe-rule-state.ts` + `_rule-state-output.txt` — re-confirms #51 divergence with full effect-axis comparison.

- **Source files referenced:**
  - `app/lib/recommendations/v2/eval/scoring.ts:91` — #54 denominator location.
  - `app/lib/catalog/rule-seeds.ts` — SEED_RULES.FASHION definition.
  - `app/lib/recommendations/v2/stage-1-hard-filters.server.ts` — #53/#55 fix surface.
  - `app/lib/recommendations/v2/stage-5-diversity.server.ts` — #52 fix surface.

- **Prior-thread artifacts referenced:**
  - Thread 1 artifact 08 (synthesis) — flip-mech-prompt-time decisions.
  - Thread 3 artifact 20 (synthesis) — α verdict and candidate op debts #52-#55.
  - Thread 3 artifact 13 — fixture inventory used in coupling analysis.
  - Thread 3 artifact 18 — d.2-strict design that #55 carries forward.

## Headline number

**F=0 / B=1 / N=8 / P=0.**

The flip ships with at most one bundled debt (#54 — the denominator semantics change). All other debts carry to 3.2.
