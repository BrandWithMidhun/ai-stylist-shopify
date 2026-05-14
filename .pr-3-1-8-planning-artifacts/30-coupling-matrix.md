# Artifact 30 — Op debt coupling matrix

Cross-reference of dependencies, blocking, and bundling between the 9 op debts triaged in Thread 2 (#43, #45, #46, #49, #51, #52, #53, #54, #55).

## Matrix legend

- **🔒 blocks:** closing the column-debt requires the row-debt closed first.
- **⤴ unblocks:** closing the row-debt enables / improves the column-debt.
- **↔ bundle:** debts naturally bundle together for a single sub-bundle.
- **○ independent:** no meaningful interaction.

The matrix is asymmetric — `M[row][col]` is read "if I close `row` first, what's the effect on `col`?"

## Coupling matrix (rows = if-this-closes, cols = effect-on)

|   | #43 | #45 | #46 | #49 | #51 | #52 | #53 | #54 | #55 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **#43** | — | ○ | ○ | ○ | ↔ | ○ | ○ | ○ | ⤴ |
| **#45** | ○ | — | ○ | ○ | ○ | ⤴ | ○ | ○ | ○ |
| **#46** | ○ | ○ | — | ○ | ○ | ○ | ⤴ | ○ | ⤴ |
| **#49** | ○ | ○ | ○ | — | 🔒 | ○ | ⤴ | ○ | ⤴ |
| **#51** | ↔ | ○ | ○ | ⤴ | — | ○ | ○ | ○ | ⤴ |
| **#52** | ○ | ○ | ○ | ○ | ○ | — | ↔ | ○ | ↔ |
| **#53** | ○ | ○ | ⤴ | ○ | ○ | ↔ | — | ⤴ | ↔ |
| **#54** | ○ | ○ | ○ | ○ | ○ | ○ | ⤴ | — | ⤴ |
| **#55** | ⤴ | ○ | ⤴ | ⤴ | ⤴ | ↔ | ↔ | ⤴ | — |

## Couplings worth surfacing explicitly

### Strong couplings (🔒 or ↔)

**#49 (broader category coverage) 🔒 #51 (SEED_RULES divergence):**
Closing #49 via rule-engine seeds (path b in artifact 24) requires resolving #51 first. Adding new SEED_RULES.FASHION category seeds is incoherent if the dev shop's TaggingRule table is already hand-customized to a different rule set. The canonical-source decision (#51 option a/b/c) must be locked before #49's implementation begins.

**#43 (gender=female) ↔ #51 (SEED_RULES divergence):**
Both involve rule-engine seeds. Dev shop's `Women's in title → gender=female` rule (priority 101) is similar to but not identical to SEED_RULES.FASHION's `Women's products` rule. #51's canonical-source decision affects whether #43 closure means "apply existing dev-shop rule" or "reset to SEED_RULES and apply." Bundling is natural.

**#52 (Stage 5 rerank-aware) ↔ #53 (Stage 2 candidatePool) ↔ #55 (deferred architectural finding):**
All three are concerns in the same Stage 2-5 ranking architecture. Thread 3 placed all three's resolution in 3.2 (with d.2-strict per #55 as the recommended primary fix). The 3.2 planning round picks one or two fix shapes from this cluster.

**#46 (size_range) ⤴ #53/#55 (d.2-strict):**
d.2-strict for `fashion-summer-shorts-size-m` requires #46 closure. Without #46, d.2-strict's hard filter on `size_range=m` returns 0 candidates (the catalog has 3 size_range-tagged products, none necessarily overlapping with the 53 shorts). Sequence #46 before or alongside d.2-strict.

**#54 (denominator semantics) ⤴ #53/#55 (eval interpretation):**
#54 affects the predicted R3 numbers for d.2-strict's recovery. If #54 keeps current rules, d.2-strict predicts ~0.75 aggregate. If #54 switches to K-based, d.2-strict's recovery is bounded by K=6 and produces slightly different numbers. The 3.2 planning round should know #54's outcome before locking R3.1 = ≥X targets.

### Coupling clusters for 3.2 planning

Three natural clusters emerge:

**Cluster 1 — ranking-architecture (#52, #53, #55):**
All address Stage 2-5 architecture. Pick one primary fix (d.2-strict per Thread 3, or d.4 per #52, or d.3). Resolve #54's denominator question first (it affects R3 anchor) or alongside.

**Cluster 2 — catalog-data (#46, #49, #51):**
All address tagging quality and canonical-source contracts. Sequence: #51 (canonical-source decision) → #49 (more category seeds) → #46 (size_range variant-option extractor). Each builds on the previous.

**Cluster 3 — deferred decisions (#43, #45):**
Both are decision-shape debts that benefit from real-merchant data. Phase 5+ territory unless 3.2 has bandwidth.

## Sequence dependencies for 3.2

The cleanest 3.2 ordering, given couplings:

1. **#54** (denominator semantics) — if not closed in 3.1.8, must close early in 3.2 to anchor R3 numbers.
2. **#51** (canonical-source decision) — unblocks #49 and #43.
3. **#49** (broader category coverage) — depends on #51.
4. **#43** (gender=female rule apply) — depends on #51 (consistent rule set).
5. **#46** (size_range variant-option extractor) — independent of catalog-data cluster; depends only on Stage 1 surface.
6. **#55 / #53** (d.2-strict implementation) — depends on #46 for shorts fixture; depends on #49 for category coverage.
7. **#52** (rerank-aware Stage 5) — orthogonal alternative; pick instead of d.2-strict OR ship after d.2-strict surfaces problems.
8. **#45** (in-stock pathology) — needs multi-shop production data; carry to Phase 5 unless 3.2 ships a temporary mitigation.

This sequencing implies 3.2 is a sub-bundle with at minimum 4-5 mechs (#54, #51, #49, #55+#53, optional #46). #43 fits as a smaller mech. #45 and #52 stay deferred.

## Sequence implications for 3.1.8

If 3.1.8 closes per Thread 3 + Thread 2 verdicts:
- **(c-future)** policy entry (Thread 3) — bundle in close, 0 LOC.
- **#54 denominator** (Thread 2 recommendation B) — bundle in close, ~15 LOC + re-anchor.
- Flip itself, verification, legacy v1 deletion.
- No other op debts close in 3.1.8.

If 3.1.8 prefers Thread 2's alternative (N for #54):
- Just flip + verification + legacy v1 deletion + (c-future) entry.

Either shape keeps 3.1.8 at 3-5 mechs.

## Op debts logically eligible for 3.1.8 bundling

After all assessments, only TWO op debts ranked above the "deferred to 3.2" floor:

- **#54** (denominator semantics) — Thread 2 verdict (B): bundle-with-flip in 3.1.8 close.
- **#43** (gender=female) — Thread 2 verdict (N) but upgradeable to (B) if planning round prefers visible eval-progress signals. Conditional upgrade documented in artifact 21.

All other debts (#45, #46, #49, #51, #52, #53, #55) carry to 3.2 unambiguously per Thread 2 verdicts.

## Implication for the planning-round close

The planning-round close picks among 3 scope shapes:

1. **Minimum 3.1.8** (Thread 3's recommended shape): flip + verification + (c-future) HANDOFF entry. ~3 mechs.
2. **Add #54 closure**: + denominator change + R3 re-anchor. ~4 mechs.
3. **Add #54 + #43**: + gender rule apply + verification. ~5-6 mechs.

Shape 2 is Thread 2's recommended addition (artifact 28 (B) verdict). Shape 3 is conditional on the planning round preferring eval-progress visibility.

3.1.8 cleanly avoids the entire 3.2 ranking-architecture + catalog-data clusters via this triage.
