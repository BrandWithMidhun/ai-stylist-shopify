# .pr-3-1-8-planning-artifacts — 3.1.8 planning round investigation artifacts

This directory captures the 3.1.8 planning round's three-thread investigation. Threads ran out of order: Thread 1 then Thread 3 then Thread 2 (Thread 3 was sequenced before Thread 2 because Thread 3's fork resolution drives Thread 2's prerequisite-triage outcome).

- **Thread 1: Flip-site re-verification** — artifacts 01-08 — COMPLETE. Re-confirmed 3.1.7 Thread 1's findings against current main. Flip is still ~3 edits; surface parity cleaner post-mech.2 variant-loading wire.
- **Thread 3: Ranking-gap fork resolution** — artifacts 09-20 — COMPLETE. Investigates fix (a)/(b)/(c) for the ranking-vs-tag-completeness gap surfaced by 3.1.7 mech.4. Resolves: defer to 3.2 with d.2-strict + (c-future) recommendation; flip ordering = Option α (flip first).
- **Thread 2: Prerequisite triage** — artifacts 21-32 — COMPLETE. Triages op debts #43/#45/#46/#49/#51 + Thread 3's #52/#53/#54/#55. Verdict distribution F=0 / B=1 / N=8 / P=0. Load-bearing surprise: #54 (denominator semantics) is the only bundle-with-flip recommendation.

Numbering: Thread 1 = 01-08; Thread 3 = 09-20; Thread 2 = 21-32.

**Investigation discipline:** read-only. No source changes in any thread (Thread 3 used a throwaway branch for fix (a) eval simulation; branch deleted before commit). Locked-decisions table + mech decomposition land in `docs/planning/3-1-8-<topic>.md` at planning round close.

## Thread 2 quick reference

Verdict distribution (artifact 31): F=0 / B=1 / N=8 / P=0.

- (F) flip-blocking: **none**.
- (B) bundle-with-flip: **#54** (relaxedMatchAtK denominator semantics — switch to K-based, re-anchor R3 ladder).
- (N) next-sub-bundle (3.2): #43, #45, #46, #49, #51, #52, #53, #55.
- (P) Phase 5+: none primary; #45 and #52 have P-edge qualifiers.

Load-bearing finding (artifact 28): **#54 denominator semantics is a measurement-contract decision** that affects R3 ladder interpretation. The mech.4 kurta regression (0.3333 → 0.2917) was an artifact of the small-pool incentive in `Math.max(1, top.length)` normalization. Switching to K-based (`Math.max(1, k)`) prevents future small-pool-favoring regressions. ~15 LOC change.

Recommended 3.1.8 mech decomposition (artifact 31):
- mech.1: #54 denominator change + scoring tests.
- mech.2: v1→v2 flip (registry edit).
- mech.2.5: flip verification probe + dev-shop smoke test.
- mech.3: legacy v1 tool deletion.
- mech.4 (close): HANDOFF amendment (re-anchored R3.0/R3.1/R3.2 + (c-future) policy + #51 direction + op debts #52-#55).

Total: ~4-5 mechs. Stays within 3.1.7 sub-bundle cadence.

3.2 cluster preview (artifact 32 § 5):
- Cluster 1 (ranking-architecture): #52, #53, #55. d.2-strict is Thread 3's primary fix.
- Cluster 2 (catalog-data): #46, #49, #51. Sequence: #51 → #49 → #46.
- Cluster 3 (deferred decisions): #43, #45. Phase 5+ unless 3.2 has bandwidth.

## Thread 3 quick reference

Load-bearing findings (artifact 20 § 8):
- Fix (a) Stage 3 rerank tag-overlap: **NULL eval impact** (empirical, artifact 14).
- Fix (b) Stage 5 axis-coverage quota: marginal +0.028 (paper-and-pencil).
- Fix (c) proportional coverage discipline: forward-only; 0 immediate eval recovery.
- **Fix (d.2-strict) emerged from probe evidence:** Stage 1 secondary-axis hard filter on extracted query axes. Predicted +0.45 aggregate.

Recommended planning-round decisions (artifact 20 § 9):
- Flip ordering: **Option α** (flip first, ranking-gap fix in 3.2).
- R3.1 target: 0.2917 (no regression).
- 3.1.8 includes (c-future) policy: yes (zero LOC).

Candidate op debts added by Thread 3: #52, #53, #54, #55. All triaged by Thread 2.

## Thread 1 quick reference

Flip site is still ~3 edits at `app/lib/chat/tools/registry.server.ts:75-78`. Surface parity is now cleaner post-mech.2 variant-loading wire (no remaining gap). The flip ships in 3.1.8-mech.2 per the recommended decomposition.

## Planning round closed

The 3.1.8 planning round closes with `docs/planning/3-1-8-flip-and-measurement-correction.md` as the locked architecture document. The locked-decisions table is in Section 10 of that document.

3.1.8 mech chain begins with mech.1 (relaxedMatchAtK denominator switch); 4-5 mechs total to close the sub-bundle. After 3.1.8 closes, 3.2 planning round addresses the ranking-architecture cluster (#52, #53, #55, d.2-strict) + catalog-data cluster (#46, #49, #51).
