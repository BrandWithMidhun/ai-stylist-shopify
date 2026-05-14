# Artifact 31 — Triage ranking

Summary of the 9 op debts triaged in Thread 2, organized by verdict.

## Verdict legend

- **(F) flip-blocking** — must close in 3.1.8 BEFORE the flip ships.
- **(B) bundle-with-flip** — not flip-blocking, but cheap and beneficial to include in 3.1.8.
- **(N) next-sub-bundle** — carries to 3.2.
- **(P) Phase 5+** — carries beyond 3.2.

## Ranking

### F (flip-blocking)

**None.**

Thread 2 found no op debt that strictly blocks the v1→v2 flip itself. The flip is a registry edit; v2's pipeline operates against current catalog state and produces user-facing results. No op debt prevents shipping.

The predicted F candidate from the Thread 2 spec was #54 (relaxedMatchAtK denominator semantics). Artifact 28 analysis settles on (B) — the flip is verifiable under either denominator semantics, so #54 is bundle-with-flip rather than flip-blocking. The (F) verdict overstates urgency.

### B (bundle-with-flip)

**1 debt: #54** (relaxedMatchAtK denominator semantics).

Source artifact: 28. Verdict reasoning: ~15 LOC change to `scoring.ts` + R3 re-anchor in HANDOFF. Bundles cleanly with the 3.1.8 close commit's existing HANDOFF amendment. Surfacing the denominator semantics as a deliberate planning-round decision prevents future mech.4-style regressions where small-pool incentives silently distort the eval trajectory.

Conditional 2nd debt: **#43** (gender=female axis at 0% APPROVED) is N by default but upgradeable to B if the planning round prefers visible eval-progress signals (e.g., R3.1 = 0.30+ as forward target rather than 0.2917 floor). Source: artifact 21.

### N (next-sub-bundle = 3.2)

**6 debts: #43, #45 [edge: P], #46, #49, #51, #52, #53, #55.**

Wait — that's 8 not 6 because of dupes. Let me recount:

- #43 — N (default; upgradeable to B). Source: 21.
- #45 — N (or P). Source: 22.
- #46 — N (alongside d.2-strict). Source: 23.
- #49 — N (depends on #51). Source: 24.
- #51 — N (with embedded planning-round decision on canonical-source direction). Source: 25.
- #52 — N (or P if 3.2 picks d.2-strict alone). Source: 26.
- #53 — N (the d.2-strict primary fix site). Source: 27.
- #55 — N (deferred architectural finding by design). Source: 29.

Total N: 8 debts. With #54 in B, total triaged: 9 of 9.

### P (Phase 5+)

**None as primary verdict.**

Two debts have "or P" qualifiers:
- #45 (in-stock pathology) — N/P. Real-merchant data dependency could push it past 3.2.
- #52 (Stage 5 rerank-aware) — N/P. If 3.2 picks d.2-strict alone and doesn't touch #52, it carries indefinitely.

## Verdict distribution headline

**F: 0** / **B: 1 (with conditional +1)** / **N: 8** / **P: 0**

The cleanest interpretation: Thread 2 finds NO flip-blocking debts and a single bundle-with-flip debt (#54). The 3.1.8 sub-bundle ships as flip + verification + close + (c-future) entry + #54 denominator close. All other debts (#43, #45, #46, #49, #51, #52, #53, #55) carry to 3.2.

If the planning round prefers minimum scope, #54 also carries to 3.2 (verdict reverts to N) and 3.1.8 ships at the smallest cadence.

## Per-debt source artifacts and one-line verdict rationale

| # | Title | Verdict | Source | One-line rationale |
|---|---|---|---|---|
| 43 | gender=female axis at 0% APPROVED | N (→B) | 21 | Flip doesn't depend on it; closure produces uncertain eval movement (0 to +0.08). |
| 45 | in-stock ratio question | N (→P) | 22 | Decision needs multi-shop data unavailable in 3.1.8; eval impact = 0 regardless. |
| 46 | size_range AI-tagger reliability | N | 23 | Scope ~100 LOC; couples to d.2-strict in 3.2. |
| 49 | broader category-coverage gap | N | 24 | Depends on #51's canonical-source decision; eval impact on fixture suite is near-zero. |
| 51 | dev shop SEED_RULES divergence | N (decision named at close) | 25 | Canonical-source decision is meta-policy; recommend "starter template" framing. |
| 52 | Stage 5 ignores rerankBoosts | N (→P) | 26 | Standalone eval value minimal; orthogonal to Thread 3's d.2-strict primary fix. |
| 53 | Stage 2 candidatePool dilution | N | 27 | d.2-strict in 3.2 is the fix; empty-Stage-1 risk needs production traffic. |
| 54 | relaxedMatchAtK denominator semantics | **B** | **28** | **Load-bearing surprise: ~15 LOC + re-anchor. Locks measurement contract.** |
| 55 | deferred architectural finding (α) | N | 29 | Exists as 3.2 prerequisite by definition (Thread 3 α verdict). |

## Comparison to spec predictions

The Thread 2 spec predicted:
- F: none, OR #54 only.
- B: possibly #43.
- N: #46, #49, #51, #52, #53, #55.
- P: none anticipated.

Reality:
- F: none (matches "none" branch).
- B: #54 (matches "#54 only" rather than #43).
- N: #43 (default), #45, #46, #49, #51, #52, #53, #55.
- P: none (matches).

The deltas: #54 is B (matches prediction's #54 only branch); #43 is N rather than B (prediction was slightly more lenient). Overall the spec's predictions hold.

## 3.1.8 mech decomposition implication

Given F=0 and B=1, 3.1.8 = ~4 mechs:

| Mech | Scope |
|---|---|
| 3.1.8-mech.1 | #54 denominator change + scoring tests (~15 LOC + 2 test updates) |
| 3.1.8-mech.2 | v1→v2 flip (registry edit, ~8 LOC) |
| 3.1.8-mech.2.5 | Flip verification probe + dev-shop smoke test |
| 3.1.8-mech.3 | Legacy v1 tool deletion (cleanup) |
| 3.1.8-mech.4 (close) | HANDOFF amendment with: re-anchored R3.0/R3.1/R3.2 + (c-future) policy entry + #51 canonical-source direction + op debts #52-#55 added |

If #54 reverts to N, 3.1.8 = ~3-4 mechs (drop mech.1, R3 re-anchor logic stays in close). Identical scope shape; the choice is just whether the denominator change ships in 3.1.8 or 3.2.

## Mech-count summary table

| Scope variant | F | B | Total mechs in 3.1.8 |
|---|---:|---:|---:|
| Minimum (#54 → N) | 0 | 0 | ~3-4 (flip + verification + cleanup + close) |
| **Thread 2 recommended (#54 → B)** | 0 | 1 | **~4-5 (flip + verification + cleanup + denominator + close)** |
| With #43 upgraded to B | 0 | 2 | ~5-6 |

The Thread 2 recommended shape stays well within the 3.1.7 sub-bundle cadence (which was 5 mechs + verification commits).
