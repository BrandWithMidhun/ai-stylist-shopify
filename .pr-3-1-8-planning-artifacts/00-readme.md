# .pr-3-1-8-planning-artifacts — 3.1.8 planning round investigation artifacts

This directory captures the 3.1.8 planning round's three-thread investigation. Threads ran out of order: Thread 1 then Thread 3 then Thread 2 (Thread 3 was sequenced before Thread 2 because Thread 3's fork resolution drives Thread 2's prerequisite-triage outcome).

- **Thread 1: Flip-site re-verification** — artifacts 01-08 — COMPLETE. Re-confirmed 3.1.7 Thread 1's findings against current main. Flip is still ~3 edits; surface parity cleaner post-mech.2 variant-loading wire.
- **Thread 3: Ranking-gap fork resolution** — artifacts 09-20 — COMPLETE. Investigates fix (a)/(b)/(c) for the ranking-vs-tag-completeness gap surfaced by 3.1.7 mech.4. Resolves: defer to 3.2 with d.2-strict + (c-future) recommendation; flip ordering = Option α (flip first).
- **Thread 2: Prerequisite triage** — artifacts after 20 — PENDING. Assesses op debts #43/#45/#46/#49/#51 (plus Thread 3's new candidates #52/#53/#54/#55) for 3.1.8 prerequisite status.

Numbering: Thread 1 = 01-08; Thread 3 = 09-20; Thread 2 starts after 20.

**Investigation discipline:** read-only. No source changes in any thread (Thread 3 used a throwaway branch for fix (a) eval simulation; branch deleted before commit). Locked-decisions table + mech decomposition land in `docs/planning/3-1-8-<topic>.md` at planning round close.

## Thread 3 quick reference

Load-bearing findings (artifact 20 § 8):
- Fix (a) Stage 3 rerank tag-overlap: **NULL eval impact** (empirical, artifact 14). Premise check (artifact 10) and simulation (artifact 15) explain why: Stage 5 selects by similarity-distance order, ignoring Stage 3's rerankBoosts.
- Fix (b) Stage 5 axis-coverage quota: marginal +0.028 (paper-and-pencil, artifact 16). Doesn't help the 3 STAGE_2_NARROWING fixtures.
- Fix (c) proportional coverage discipline: forward-only; 0 immediate eval recovery. Free as a HANDOFF amendment.
- **Fix (d.2-strict) emerged from probe evidence:** Stage 1 secondary-axis hard filter on extracted query axes. Predicted +0.45 aggregate (artifact 18). Empty-Stage-1 risk on real merchant queries.

Recommended planning-round decisions (artifact 20 § 9):
- Flip ordering: **Option α** (flip first, ranking-gap fix in 3.2).
- R3.1 target: 0.2917 (no regression).
- 3.1.8 includes (c-future) policy: yes (zero LOC).
- 3.1.8 mech count: preliminary ~5 (3 mech + 1 verification + 1 close, plus Thread 2 prerequisite closures).

Candidate op debts added by Thread 3: #52 (Stage 5 ignores rerankBoosts), #53 (Stage 2 candidatePool dilution), #54 (`relaxedMatchAtK` denominator semantics), #55 (deferred architectural finding if α accepted).
