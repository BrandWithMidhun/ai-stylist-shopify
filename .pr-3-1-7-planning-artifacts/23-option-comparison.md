# Option comparison — 3.1.7 reformulated options

Source data: Threads 1 + 2 + Thread 3 op-debt re-pull (#11, #15) +
locked-decision capture (artifact 22).

Every "Eval impact" cell uses Thread 2's per-fixture probe data
(artifact 14) — predictions are derived from per-fixture math, not
hand-waved.

| | A: Ship flip v2-as-is | B.i: Soften Stage 1 (drop hard-filter on empty result) | B.ii: Move availability filter out of Stage 1 | C: Defer flip — fix Stage 1 universe first | D: Bulk-approve more axes | E: Vocabulary expansion (saree, shorts) |
|---|---|---|---|---|---|---|
| **Mech sizing** | Medium (1.5–2 mechs: variant-loading + flip) | Small (1 mech) | Large (3–4+ mechs; planning-round-of-its-own potential) | Large (≈ B.ii sized) but with cleaner sub-bundle boundary (no flip mixed in) | Small (1 mech: re-target bulk-approve script to occasion/color/material/etc.) | Small (1 mech: tag a few saree + shorts products APPROVED) |
| **Touches op debt** | #15 (closes), #11 (untouched) | #11 (touches but doesn't resolve) | #11 (resolves), #15 (couples — must ship simultaneously) | #11 (resolves), #15 (defers to 3.1.8) | None (orthogonal) | #10 (partial — sample category distribution) |
| **Eval impact (predicted)** | aggregateScore: 0.0833 → 0.0833 OR ≤0.0833 if v2's pipeline finds different top-1 trouser product. Could even REGRESS if Stage 1's 1-product trouser candidate isn't returned by the v2 extraction path | 8 EMPTY → still EMPTY (variant filter applies first; soften only kicks in IF Stage 1 returned 0; relaxed-pass would still hit 29-universe and find 0 with category=shirt). 3 NO-HARD-FILTER → no change. 1 SPARSE → no change. **Predicted: 0.0833 (no movement)** | Stage 1 universe: 29 → 1,169. Stage 2 (semantic retrieval) ranks against full embedded set. 8 EMPTY fixtures: candidates available but secondary-axis APPROVED is still 0% catalog-wide → relaxed=0 → still FAIL. 3 NO-HARD-FILTER fixtures: same scoring problem. 1 SPARSE: still 1.0. **Predicted: 0.0833 (no movement) UNLESS B.ii is paired with D for the secondary axes** | Same as B.ii in eval terms. 0.0833. | Without B.ii: zero impact (still capped at 29-universe). With B.ii: lifts secondary-axis APPROVED from 0% toward 4%, lifts a few fixtures from FAIL to PARTIAL/PASS. **B.ii + D pairing: predicted 0.25–0.40** | Adds 0–4 saree/shorts to APPROVED catalog; without B.ii doesn't reach Stage 1 unless those products are already in the 29-universe. **Predicted: probably 0.0833** |
| **User-visible impact** | NEGATIVE — every recommended product shows as OOS (variantId=null), Add-to-Cart disabled. Functional regression vs current chat. (Closes if variant-loading mech ships first per #15.) | None or near-none — the 29-universe still bounds candidate count. User sees same/similar recommendations as v1 today | LARGE — 40× more candidates per query → more diverse + more relevant top-K. But OOS items would now appear unless Stage 5/6 substitution lands in the same bundle | None in 3.1.7 (no flip). 3.1.8 ships flip + universe fix together → user sees v2 recs with healthy candidate sets | None at the chat surface. Eval-only impact unless paired with B.ii | Saree + shorts queries get 1 candidate each instead of 0 (and only after B.ii — otherwise no change) |
| **Architectural correctness** | LOW — ships v2 known-broken (placeholders); creates regression debt | LOW — patches a symptom (Stage 1 empty result), leaves the root cause (variant filter) unaddressed; introduces an empty-result code path that's silently degenerate | HIGH — moves toward Stage 6/widget-as-availability-authority, the eventual right shape per recommendation-engine-brief intent. Couples to OOS-substitute work that was deferred at mech.5 (#11) | HIGH — preserves the "flip ships when v2 demonstrably better" discipline. Avoids shipping a known-degenerate flip just to clear the 3.1.7 milestone. Honors the project pattern of choosing best-practice over convenience | NEUTRAL — bulk-approve was always going to ship as Phase 5 catalog-tagging precursor. Doing it now or later is a sequencing choice, not a correctness one | NEUTRAL — vocabulary gaps need fixing eventually; whether now or in Phase 5 is a sequencing choice |
| **Risks** | (1) Add-to-Cart silently broken on every recommendation. (2) Eval baseline reads as "improved" mathematically but user-visible regression goes uncaught. (3) Sets precedent of shipping-known-broken in the name of hitting milestones | (1) Empty-result fallback path becomes load-bearing without a quality gate (no fixture exercises it). (2) Hidden behavior: Stage 1's hard-filter contract becomes "soft-filter when convenient", confusing future engineers reading the file header. (3) Doesn't free up any 3.1.7 work that B.ii would have done | (1) Big mech with big surface — typecheck/test churn across Stage 5, Stage 6, v2 tool stub, eval harness. (2) Re-opens mech.5 D6 deferral. (3) Couples #11 + #15 + Thread 2 universe finding into one bundle — tight coupling raises bug surface. (4) OOS items would appear in agent output unless Stage 5 substitution work is in scope | (1) 3.1.7 ships no user-visible change; can feel like "no progress". (2) Plans 3.1.8 around a v2 that has accumulated more known-good but unshipped work | (1) Approves AI tags without merchant review — same trust-gate concern that locked the APPROVED-only posture. mech.6 baseline-prep bulk-approve was a one-shot pre-launch concession, not a precedent. | (1) Manual product approval is a one-product-at-a-time merchant task; doing 4 from script feels arbitrary. (2) Doesn't generalize — each new fixture's value-axis would need this treatment |

## Per-fixture Eval prediction grid

For options A, B.i, B.ii, C, D (B.ii+D combined for the realistic-best-case row):

| Fixture | Today | Option A | Option B.i | Option B.ii | Option C | Option B.ii+D |
|---------|------:|---------:|-----------:|------------:|---------:|--------------:|
| fashion-casual-office-shirts | FAIL (0/29 universe ∩ APPROVED shirt) | FAIL | FAIL | FAIL (universe big but secondary axes 0% APPROVED) | FAIL (no flip) | PARTIAL (some shirts in expanded universe + occasion APPROVED on some) |
| fashion-festive-kurta-women | FAIL | FAIL | FAIL | FAIL | FAIL | PARTIAL/PASS |
| fashion-going-out-outfit | FAIL (29 candidates, all relaxed=0) | FAIL | no change | FAIL (still 0% occasion APPROVED) | FAIL | PARTIAL |
| fashion-linen-shirts-white | FAIL | FAIL | FAIL | FAIL | FAIL | PARTIAL |
| fashion-minimalist-daily-wear | FAIL | FAIL | no change | FAIL | FAIL | PARTIAL |
| fashion-oos-stress-1 | FAIL | FAIL | FAIL | FAIL | FAIL | PARTIAL |
| fashion-oos-stress-2 | FAIL (saree=0 catalog APPROVED) | FAIL | FAIL | FAIL (no saree to find) | FAIL | needs E too |
| fashion-oversized-fit-kurta | FAIL | FAIL | FAIL | FAIL | FAIL | PARTIAL/PASS |
| fashion-show-jackets | FAIL (5 catalog APPROVED, 0 in 29-universe) | FAIL | FAIL | likely PASS (5 jackets in expanded universe) | FAIL | PASS |
| fashion-show-trousers | PASS | PASS or FAIL (depending on v2 ranking on 1-candidate set) | PASS | PASS | PASS | PASS |
| fashion-summer-shorts-size-m | FAIL (shorts=0 catalog APPROVED) | FAIL | FAIL | FAIL | FAIL | needs E too |
| fashion-wedding-reception | FAIL (29 candidates, occasion 0% APPROVED) | FAIL | no change | FAIL | FAIL | PARTIAL |

**Predicted aggregateScore by option:**

| | aggregateScore (estimate) |
|---|---|
| Today | 0.0833 |
| A (flip alone) | 0.0833 ± regression risk |
| B.i (soften Stage 1) | 0.0833 |
| B.ii (variant filter relocate) | 0.08–0.17 (jacket fixture flips PASS; little else) |
| C (defer flip; ship universe fix) | 0.0833 (no flip in 3.1.7) |
| D alone (bulk-approve more axes) | 0.0833 |
| **B.ii + D (universe fix + secondary-axis APPROVED)** | **~0.30–0.50** |
| B.ii + D + E (also vocabulary fix) | ~0.40–0.60 |
| C-as-foundation + 3.1.8 ships B.ii+D+E + flip | same as the bottom row, but split across two sub-bundles |

The math demands a **multi-component change** to move aggregateScore
meaningfully. Single-option picks (A, B.i, C, D, E) all stay at 0.0833.
Only B.ii + D (or its time-shifted equivalent C → 3.1.8 doing B.ii+D)
moves the eval needle.
