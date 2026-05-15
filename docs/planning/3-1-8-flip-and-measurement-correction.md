# Sub-bundle 3.1.8 — Flip + measurement correction

**Status:** PLANNING (architecture locked, mechs not yet implementing).
**Investigation threads:** 1, 2, 3 — three read-only threads complete, all artifacts in `.pr-3-1-8-planning-artifacts/`.
**Prior context:** Sub-bundle 3.1.7 closed at `d21abc0` (5-mech chain: universe correction + variant-loading + secondary-axis approval + category=shorts rule + R3 retirement; eval baseline 0.0833 → 0.2917, 3.5× cumulative lift; flip deferred to 3.1.8).
**Closes on:** the v1→v2 flip (with op debts #11 and #15 already closed in 3.1.7), the `relaxedMatchAtK` denominator measurement-contract decision (op debt #54), and HANDOFF amendments for op debts #52-#55 surfaced by Thread 3's investigation.

---

## Section 1 — Problem statement

The 3.1.7 close framed 3.1.8 as "the v1→v2 flip + whatever subset of #43/#45/#46/#49/#51 the planning round decides is prerequisite + a decision on the (a)/(b)/(c) fork for the ranking-vs-tag-completeness gap." Three read-only investigation threads refined that framing.

**Thread 1 (flip-site re-verification):** confirmed 5 of 6 of 3.1.7 Thread 1's findings still hold; the 6th changed positively — mech.2's Stage 5.5 variant-loading wire (closing op debt #15) made v2's ProductCard surface STRICTLY cleaner. The flip is now scoped as a small single mech: ~3 logical edits / ~8 lines in `app/lib/chat/tools/registry.server.ts:75-78`, with no bundled variant-loading prerequisite.

**Thread 3 (ranking-gap fork resolution):** investigated fix (a)/(b)/(c) for the ranking-vs-tag-completeness gap. All three pre-investigation predictions inverted. Fix (a) — Stage 3 rerank tag-overlap signal — produces NULL eval impact (empirical, artifact 14) because Stage 5 iterates Stage 4 input in similarity-distance order, ignoring `rerankBoosts` (op debt #52). Fix (b) — Stage 5 quota policy — produces marginal +0.028 paper-and-pencil, doesn't help the 3 STAGE_2_NARROWING fixtures. Fix (c) — proportional coverage discipline — is forward-only with 0 immediate eval recovery. The right fix is a new shape (d.2-strict) that emerged from probe evidence: Stage 1 secondary-axis hard filter on extracted query axes; predicted +0.45 aggregate. But d.2-strict has empty-Stage-1 risk that real-merchant traffic is the best test data for. Thread 3 recommends Option α (flip first, ranking-gap fix in 3.2).

**Thread 2 (prerequisite triage):** triaged 9 op debts (the original 5 from 3.1.7 plus Thread 3's 4 new candidates #52-#55). Verdict distribution: F=0 / B=1 / N=8 / P=0. The only bundle-with-flip recommendation is #54 — `relaxedMatchAtK` denominator semantics. The mech.4 kurta regression (0.3333 → 0.2917) was an artifact of `Math.max(1, top.length)` normalization favoring small candidate pools; switching to K-based normalization corrects the measurement contract before 3.2 work depends on it. ~15 LOC change. The HANDOFF op debt #51 (SEED_RULES divergence) carries to 3.2 with the planning-round close naming a preferred direction: option (c) — "SEED_RULES is the starter template, not canonical for any deployed shop."

The original "ship the flip + ranking-gap fix" question is therefore not the right shape for 3.1.8. The right shape is: **the flip, plus the denominator correction that retroactively cleans the 3.1.7 chain's eval trajectory.** Ranking-gap architecture work, catalog-data coverage work, and tagger-quality work all carry to 3.2 or later.

---

## Section 2 — Architectural decision

### Locked: Option α (flip first) + measurement correction (#54 closure)

3.1.8 ships the v1→v2 flip and the `relaxedMatchAtK` denominator-semantics correction. Ranking-gap fix work (d.2-strict + (c-future)) ships in Sub-bundle 3.2.

- **mech.1: `relaxedMatchAtK` denominator switch to K-based.** ~15 LOC change to `app/lib/recommendations/v2/eval/scoring.ts:91` (replace `Math.max(1, top.length)` with `Math.max(1, k)`) + 2 test updates in `scoring.test.ts`. Re-runs eval to capture the re-anchored R3.0 baseline. Surfaces the measurement contract as a locked decision before 3.2's ranking-gap work proceeds.
- **mech.2: v1→v2 flip (registry edit).** ~3 logical edits / ~8 lines in `app/lib/chat/tools/registry.server.ts:75-78` per Thread 1 artifact 02. Replaces the v1 tool registration with v2's. Integration tests in `agent.server.test.ts` updated to mock the v2 surface. Single seam, single consumer, single user-visible route.
- **mech.2.5: Flip verification artifact.** Re-run probe to confirm v2 returns real `variantId`/`available`/`compareAtPrice` on every card. Dev-shop chat smoke test capturing 2-3 representative recommendation turns. Mirrors 3.1.7's mech.N.5 pattern.
- **mech.3: Legacy v1 tool deletion.** Delete `app/lib/chat/tools/recommend-products.server.ts` and its dependents. ~-200 LOC. Post-flip, the v1 tool stub is dead code with no remaining importer (verified by Thread 1 artifact 03).
- **mech.4 (close): HANDOFF amendment + sub-bundle close.** Re-anchored R3.0/R3.1/R3.2 ladder (R3.0 = 0.2778 K-based, R3.1 ≥ 0.2778, R3.2 ≥ 0.50). (c-future) policy entry. #51 direction note (option c — "starter template"). Op debts #52, #53, #55 formally added to HANDOFF (#54 closed at mech.1; document this).

### Why this and not Option β (fix before flip)

Thread 3 artifact 19 walked through five considerations. Summarized:

1. **The flip has positive user-facing value at R3.0 = 0.2778.** v2's pipeline is structurally richer than v1 (semantic similarity + rerank + diversity + real variant data). Delaying for d.2-strict adds 3-5 weeks without proportional user-facing gain.
2. **Diagnostic separability is preserved.** Option α ships the flip and the ranking-gap fix as independent commits (3.1.8 vs 3.2). Option β couples them; if eval moves from 0.2778 to 0.75, attribution between "d.2-strict eval lift" and "flip artifact" is ambiguous.
3. **Real-merchant traffic is the right test data for d.2-strict's empty-Stage-1 risk.** Shipping the flip first lets real-merchant queries surface where d.2-strict would produce thin result sets. 3.2's planning round designs d.2-strict's parameterization against empirical query distribution data.
4. **3.1.8 scope stays disciplined.** α is ~4-5 mechs; β would be ~7 mechs.
5. **Reversibility is independent.** α's flip is one trivial revert; β's coupling means a regression's source is ambiguous before revert.

### Why bundle #54 (denominator correction) into 3.1.8 rather than carry to 3.2

Thread 2 artifact 28 settled this. Three points:

1. **The change is trivial:** ~15 LOC + R3 re-anchor in HANDOFF. Bundles cleanly with the planning-round-close HANDOFF amendment.
2. **The measurement contract must be locked before 3.2 work depends on it.** d.2-strict's eval movement (predicted +0.45 aggregate by Thread 3 artifact 18) depends on which denominator semantics are active. Locking K-based normalization in 3.1.8 gives 3.2 a stable measurement contract.
3. **Surfacing the denominator as a deliberate planning-round decision prevents future mech.4-style regressions** where small-pool incentives silently distort the eval trajectory.

### Trade-offs accepted

- **3.1.8 ships a user-visible change** (the flip itself), unlike 3.1.7. v2's storefront chat behavior replaces v1's. Eval baseline at flip time = R3.0 = 0.2778 K-based.
- **R3.0 changes from 0.2917 to 0.2778** under K-based normalization. Historical R3 trajectory (3.1.7's 0.0833 → 0.2917) becomes partially non-comparable to post-#54-closure scores. Acceptable because (a) the original numbers were artifact-of-denominator anyway, and (b) future numbers are now stably-anchored.
- **mech.4 from 3.1.7 is retroactively reframed as eval-invisible-not-regression.** The HANDOFF amendment in mech.4 (close) captures this clarification: "Under R3.0 = 0.2778 K-based anchoring, mech.4's contribution is eval-invisible rather than a regression. The architectural finding (Stages 2-5 ranking doesn't favor tag-complete candidates) holds; the measurement artifact that surfaced it as a regression dissolves."
- **The ranking-gap fix waits for 3.2.** R3.1 stays at 0.2778 floor across 3.1.8; the eval lift to ~0.5+ waits for 3.2's d.2-strict.

### Why mech.1 (denominator) ships before mech.2 (flip)

Two reasons:

1. **R3.1 anchoring stability.** The flip's verification is "v2 eval ≥ R3.1." If R3.1 is defined under K-based normalization, the eval that verifies the flip must already run K-based scoring. mech.1 ships denominator first; mech.2.5's verification runs against the corrected scoring.
2. **Diagnostic separability.** Eval delta at mech.2 commit time is attributable purely to the flip's pipeline differences, not to denominator semantics. If both shipped in one mech, eval delta would be ambiguous.

The ordering also matches 3.1.7's pattern (verification-clean ordering: small-mech first, anchor-mech second, verification-mech third).

---

## Section 3 — Mech-commit shape

### PR-3.1.8-mech.1 — `relaxedMatchAtK` denominator switch to K-based (~15 LOC, 2 test updates)

- Change `app/lib/recommendations/v2/eval/scoring.ts:91`: `Math.max(1, top.length)` → `Math.max(1, k)`.
- Update `scoring.test.ts` — 2 existing tests that assert against current denominator. Add 1 new test asserting K-based normalization on a fixture with `actualWithTags.length < k`.
- Re-run eval to capture new aggregateScore. Expected: 0.2917 → 0.2778 (delta −0.0139). The only fixture affected is `fashion-show-jackets` (5/5 → 5/6 = 1.000 → 0.833; remains PASS above PASS_THRESHOLD=0.75).
- Capture eval re-run output in `.pr-3-1-8-mech-1-artifacts/01-eval-post-denominator-switch.txt`.

### PR-3.1.8-mech.2 — v1→v2 flip (registry edit) (~8 LOC, 1-2 integration test updates)

- Edit `app/lib/chat/tools/registry.server.ts:11-14/29/38-42` per Thread 1 artifact 02:
  - Replace v1 tool import with v2.
  - Update tool registration list.
  - Update switch case body that resolves the tool name to a handler.
- Update integration tests in `app/lib/chat/agent.server.test.ts` to mock v2's surface instead of v1's. Specifically: any test currently asserting against `recommend-products.server.ts`'s exports.
- DECISION DEFERRED TO MECH.2 PROMPT TIME: whether to delete `recommend-products.server.ts` in this commit, or land that as a follow-up cleanup mech (currently scoped as mech.3). Recommend the latter — bigger, separable rollback story. Lock at mech.2 prompt time.

### PR-3.1.8-mech.2.5 — Flip verification artifact (~30 LOC probe + dev-shop smoke test)

- Probe-driven: invoke v2's `recommend-products-v2.server.ts` directly on 3 representative fixture intents. Capture returned `ProductCard[]`. Assert each card has populated `variantId`, accurate `available` boolean, populated `compareAtPrice` (or null per legacy `recommend-products.server.ts:144-148`'s policy). Capture in `.pr-3-1-8-mech-2-artifacts/02-flip-probe.json`.
- Dev-shop smoke: manually issue 2-3 chat queries against `web-production-3b1d7.up.railway.app`'s chat widget. Confirm Add-to-Cart appears on returned product cards. Capture screenshots or recordings in `.pr-3-1-8-mech-2-artifacts/03-dev-shop-smoke.md` (or similar evidence form).
- Eval re-run: `npx tsx --env-file=.env scripts/run-eval.ts --all`. Confirm aggregateScore ≥ R3.1 = 0.2778. Capture in `.pr-3-1-8-mech-2-artifacts/04-eval-post-flip.txt`.

### PR-3.1.8-mech.3 — Legacy v1 tool deletion (~-200 LOC, removes v1 tests)

- Delete `app/lib/chat/tools/recommend-products.server.ts`.
- Delete its tests (if any standalone test file exists).
- Remove any imports of the v1 module (the registry was the only consumer per Thread 1 artifact 03; verify by re-grep at mech.3 prompt time).
- Clean up any v1-specific types or helpers that are now orphaned.
- Update `recommend-products-v2.server.ts` to remove "v2" suffix from internal names if the cleanup is part of the same scope decision. DECISION DEFERRED TO MECH.3 PROMPT TIME.

### PR-3.1.8-mech.4 (close) — HANDOFF amendment + sub-bundle close (~50 LOC of HANDOFF text)

- "Sub-bundle 3.1.8 close" subsection in HANDOFF.md mirroring 3.1.7 close's shape. Content:
  - What 3.1.8 actually shipped (bulleted)
  - R3 retirement subsection: re-anchored R3.0 = 0.2778, R3.1 ≥ 0.2778, R3.2 ≥ 0.50. Explicit derivation note: "post-3.1.8 baseline derived under K-based `relaxedMatchAtK` normalization; pre-3.1.8 R3 numbers (0.0833 → 0.2917 trajectory from 3.1.7) are non-comparable due to denominator semantics change. Historical R3 retired; new ladder is the canonical anchor going forward."
  - "Architectural finding retroactive reframing" subsection: mech.4 from 3.1.7 was eval-invisible, not a regression. The Stages 2-5 ranking architectural finding still holds.
  - 3.2 prerequisites (op debts surfaced during 3.1.8 + carried from 3.1.7): #43, #45, #46, #49, #51, #52, #53, #55. Cluster framing per Thread 2 § 5.
  - Closing meta paragraph.
- "Last updated" line in HANDOFF.md header updated to reflect 3.1.8 closed.
- "Phase 3 IN PROGRESS — sub-bundles 3.1, 3.1.5, 3.1.6, 3.1.7, and 3.1.8 closed; next: 3.2 planning round (ranking-gap fix + catalog-data cluster)."

DECISION DEFERRED TO MECH.4 PROMPT TIME: whether mech.4 also retires the "Sub-bundle 3.1.8 planning round close" subsection's relevance (i.e., the planning-doc-pointer in HANDOFF that's about to be closed). Recommend: leave the pointer; let it become historical. Lock at mech.4 prompt time.

**Total: 4 mechs + 1 verification commit = 5 commits. Stays within 3.1.7 sub-bundle cadence pattern (which was 4 mechs + 4 verification commits + 1 close = 9 commits; 3.1.8 is intentionally smaller).**

---

## Section 4 — Eval prediction grid for 3.1.8

| Anchor | Score | Source |
|---|---:|---|
| pre-3.1.8 baseline | 0.2917 | EvalRun `cmp1dlvil0000q7gg3scb6rt7`, 3.1.7 mech.4.5 |
| **mech.1 post-denominator-switch** | **0.2778** | predicted from per-fixture analysis in artifact 28 |
| mech.2 post-flip | 0.2778 ± noise | predicted no regression (v2 was already eval-pipeline-of-record); Thread 1 confirmed surface parity |
| mech.2.5 verification | 0.2778 ± noise | (same as mech.2; verification only) |
| mech.3 v1 deletion | 0.2778 ± noise | (no eval impact; pure cleanup) |
| mech.4 close (R3.0 anchor) | R3.0 = 0.2778 | locked in HANDOFF |

The expected aggregateScore trajectory across 3.1.8 mechs is 0.2917 → 0.2778 (single step at mech.1), then stable. If the flip itself produces eval movement, that's a finding worth surfacing — v2 was already the eval-pipeline-of-record, so flip-time eval movement would indicate either (a) v2 was somehow not what eval was running against, or (b) an unrelated regression slipped in.

---

## Section 5 — Test strategy

### mech.1 (denominator switch)

- Update 2 existing `scoring.test.ts` tests that exercise the `Math.max(1, top.length)` semantics. New assertions: same fixture data, denominator = K (e.g., 6 for k=6 cases).
- Add 1 new test: fixture with 2 returned candidates and 1 satisfying; old behavior was 0.50, new behavior is 1/6 ≈ 0.167. Asserts the K-based denominator.
- Eval re-run: empirical confirmation. Re-run `scripts/run-eval.ts --all`; confirm aggregateScore matches predicted 0.2778.

### mech.2 (flip)

- Update integration tests in `agent.server.test.ts` to mock the v2 surface. Identify exact tests at mech.2 prompt time via grep.
- No new tests required — Thread 1 artifact 02 found the v2 surface is a strict superset of v1's (v2 has all of v1's features plus richer return data).

### mech.2.5 (verification)

- Probe-driven assertion: ProductCard return shape from v2 matches expected schema (variantId numeric string, available boolean, compareAtPrice nullable).
- Dev-shop smoke: 2-3 chat queries, manual verification of Add-to-Cart presence on returned cards.
- Eval re-run: aggregateScore ≥ R3.1 = 0.2778. No regression.

### mech.3 (v1 deletion)

- Remove v1-specific tests when the file is deleted.
- Verify post-deletion: `npm test` should still pass at 298 (or current count minus the v1-test-count).

### mech.4 (close)

- No code tests required (HANDOFF amendment only).
- Manual review: HANDOFF reads correctly; R3 ladder values are correct; cluster framing aligns with Thread 2 § 5.

---

## Section 6 — Implementation details deferred to mech-prompt time

These are decisions too small for the planning round to lock but big enough to call out so mech prompts don't drift:

1. **Whether mech.2 deletes v1 in-place or scopes deletion to mech.3.** Lean: scope deletion to mech.3 for clean rollback story. Confirm at mech.2 prompt time after re-greping for any non-registry consumers.
2. **Whether mech.3 renames the v2 module after deletion.** `recommend-products-v2.server.ts` could be renamed to `recommend-products.server.ts` post-v1-deletion to drop the "v2" suffix. Lean: keep "-v2" suffix for now to preserve audit history; revisit after 3.2 when v2 itself may be substantially modified. Lock at mech.3 prompt time.
3. **Whether mech.4 retires the 3.1.8 planning-doc pointer in HANDOFF after close.** The planning doc stays under `docs/planning/`; HANDOFF's pointer becomes historical. Lean: leave the pointer for traceability. Lock at mech.4 prompt time.
4. **mech.2.5 dev-shop smoke evidence format.** Screenshot capture? Recording? Just a markdown narrative with timestamps? Lean: markdown narrative + the probe artifact 02-flip-probe.json. Screenshots are nice-to-have. Lock at mech.2.5 prompt time.
5. **mech.4 op debt #51 direction wording.** Thread 2 recommends "SEED_RULES is the starter template, not canonical." Final wording in HANDOFF amendment at mech.4 prompt time. The direction is locked; the prose is mech-author's call.
6. **mech.4 op debts #52/#53/#55 entry formatting.** Each gets a HANDOFF op debt entry. Format mirrors 3.1.7's #43-#51 style. Mech.4 prompt enumerates.

---

## Section 7 — Out-of-scope (deferred)

Explicitly NOT in 3.1.8:

- **d.2-strict implementation.** The Stage 1 secondary-axis hard filter. Thread 3 § 3 recommends; Thread 3 § 4 defers. Ships in 3.2 against real-merchant-traffic data.
- **(c-future) policy entry as a portal-UI gate or pre-commit hook.** mech.4 records (c-future) as a HANDOFF op-debt entry. Implementation as an enforceable gate is 3.2 or Phase 5 work.
- **Op debt #43 (gender=female axis at 0% APPROVED).** Cheap closure exists (single rule-engine seed `title_contains "women" → gender=female`). 3.2 picks it up alongside #46 (size_range tagger) and #49 (broader category coverage).
- **Op debts #45 (in-stock ratio question), #46 (size_range tagger reliability), #49 (broader category coverage), #51 (SEED_RULES divergence reconciliation), #52 (Stage 5 rerank-aware), #53 (Stage 2 narrowing), #55 (deferred architectural finding).** All carry to 3.2. Cluster framing in Thread 2 § 5.
- **#51 implementation work.** The planning-round close NAMES the direction (option c — starter template) but does NOT implement the divergence reconciliation. Implementation in 3.2 as part of the catalog-data cluster.
- **Multi-tenant verification (op debt #50).** Phase 5 territory.
- **Removing the `recommend-products-v2.server.ts` "-v2" suffix** (post-deletion of v1). Lock direction at mech.3 prompt time; defer the rename itself until 3.2 stabilizes v2.

---

## Section 8 — Risks

### Risk 1 — mech.1 denominator switch produces unexpected eval movement

Thread 2 artifact 28's per-fixture analysis predicts only `fashion-show-jackets` is affected (5/5 → 5/6). If the eval re-run reveals additional fixtures shift, that's a finding worth surfacing.

**Mitigation:** mech.1 prompt explicitly captures pre-and-post per-fixture scores. mech.1.5 (if used) verifies the analysis.

### Risk 2 — Flip eval delta surfaces v2/eval-runner divergence

Thread 1 confirmed v2 IS the eval-pipeline-of-record. If post-flip eval moves meaningfully, the divergence is the finding.

**Mitigation:** mech.2.5 captures eval re-run; any unexpected movement triggers surface-and-stop.

### Risk 3 — Dev-shop chat widget breaks at flip time

The flip is a registry change; agent → tool → response chain should be unchanged. But the integration test surface is the weakest tested area.

**Mitigation:** mech.2.5 includes manual dev-shop chat queries. Real chat → Add-to-Cart flow is verified manually before close.

### Risk 4 — Op debt #54 K-based normalization affects 3.2's d.2-strict prediction

Thread 3's d.2-strict prediction of +0.45 aggregate was computed under current rules. Under K-based, the same recovery pattern produces slightly different numbers because some recovered fixtures may have `top.length < k` (e.g., a strict-filter shorts query returning 3 candidates → 3/6 = 0.50 K-based vs 3/3 = 1.0 under current).

**Mitigation:** 3.2 planning round re-computes d.2-strict prediction under K-based rules. The planning artifact's prediction grid (Section 4) is re-anchored at that time.

---

## Section 9 — References

- **Investigation artifacts (this planning round, `.pr-3-1-8-planning-artifacts/`):**
  - Thread 1 (8 artifacts, 01-08): flip-site re-verification.
  - Thread 3 (12 artifacts, 09-20): ranking-gap fork resolution; throwaway-branch fix-(a) simulation; d.2-strict emergence.
  - Thread 2 (12 artifacts, 21-32): prerequisite triage; #54 surfaces as load-bearing.
  - `00-readme.md` — directory index with quick-reference sections for each thread.

- **Synthesis artifacts (load-bearing):**
  - Thread 1: `08-thread-1-synthesis.md`
  - Thread 3: `20-thread-3-synthesis.md`
  - Thread 2: `32-thread-2-synthesis.md`

- **Empirical proof points:**
  - Thread 3 artifact 14: fix (a) eval result = 0.2917 (null delta)
  - Thread 2 artifact 28: R3.0 = 0.2778 under K-based normalization
  - Thread 1 artifact 02: flip is ~3 edits / ~8 lines at `registry.server.ts:11-14/29/38-42`

- **Prior closure commits:**
  - `8bf9da8` (Sub-bundle 3.1 close)
  - `3cdf212` (Sub-bundle 3.1.5 close)
  - `e48e079` (Sub-bundle 3.1.6 close)
  - `d21abc0` (Sub-bundle 3.1.7 close)
  - `6176311` (Sub-bundle 3.1.7 planning round close) — precedent for this planning-round-close commit shape

- **Anchor source files referenced throughout:**
  - `app/lib/recommendations/v2/eval/scoring.ts:91` — mech.1 modification site
  - `app/lib/chat/tools/registry.server.ts:11-14/29/38-42` — mech.2 modification site
  - `app/lib/chat/tools/recommend-products.server.ts` — mech.3 deletion target
  - `app/lib/chat/tools/recommend-products-v2.server.ts` — v2 tool stub (mech.2 anchor)
  - `app/lib/recommendations/v2/pipeline.server.ts` — orchestrator (no source change in 3.1.8)
  - `HANDOFF.md` — mech.4 amendment target

---

## Section 10 — Locked-decisions table

| Decision | Locked answer | Source |
|---|---|---|
| **Architecture** | Option α: 3.1.8 ships flip + #54 denominator correction; ranking-gap fix in 3.2 | Thread 3 § 3 + Thread 2 § 8 |
| **Flip ordering** | Flip first (Option α). Ranking-gap fix in 3.2. | Thread 3 artifact 19 |
| **Bundle #54 into 3.1.8** | Yes (B verdict from Thread 2). ~15 LOC denominator switch + R3 re-anchor. | Thread 2 artifact 28 |
| **Mech ordering** | mech.1 (denominator) → mech.2 (flip) → mech.2.5 (verification) → mech.3 (v1 deletion) → mech.4 (close). | Thread 2 § 4 |
| **R3.0 anchor (post-denominator switch)** | 0.2778 under K-based `Math.max(1, k)` normalization | Thread 2 artifact 28 |
| **R3.1 target (3.1.8 flip)** | ≥ 0.2778 (no regression) | Thread 3 § 4 + Thread 2 § 4 |
| **R3.2 target (Phase 5 multi-mode)** | ≥ 0.50 (policy-level; unchanged) | 3.1.7 close |
| **Op debt #43 (gender axis)** | (N) carry to 3.2 | Thread 2 artifact 21 |
| **Op debt #45 (in-stock ratio)** | (N) carry to 3.2 (or P) | Thread 2 artifact 22 |
| **Op debt #46 (size_range tagger)** | (N) carry to 3.2 alongside d.2-strict | Thread 2 artifact 23 |
| **Op debt #49 (broader category coverage)** | (N) carry to 3.2 (depends on #51) | Thread 2 artifact 24 |
| **Op debt #51 (SEED_RULES divergence)** | (N) carry to 3.2. Direction: option (c) — "SEED_RULES is starter template, not canonical." | Thread 2 artifact 25 |
| **Op debt #52 (Stage 5 ignores rerankBoosts)** | (N) carry to 3.2 (or P) | Thread 2 artifact 26 |
| **Op debt #53 (Stage 2 narrowing)** | (N) carry to 3.2 (the d.2-strict fix site) | Thread 2 artifact 27 |
| **Op debt #54 (denominator semantics)** | (B) closed in 3.1.8 mech.1 via K-based switch | Thread 2 artifact 28 |
| **Op debt #55 (deferred architectural finding)** | (N) carry to 3.2 (deferred by definition under α) | Thread 2 artifact 29 |
| **3.2 cluster framing** | Cluster 1 (ranking-architecture): #52, #53, #55, d.2-strict. Cluster 2 (catalog-data): #46, #49, #51. Cluster 3 (deferred): #43, #45. | Thread 2 § 5 |

---
