# Artifact 25 — Op debt #51 assessment: dev shop SEED_RULES.FASHION divergence

## 1. Verbatim re-pull (HANDOFF.md:729)

> 51. Dev shop's TaggingRule table contains rules that diverge from `SEED_RULES.FASHION`. Discovered at mech.4.5 (`.pr-3-1-7-mech-4-artifacts/_inspect-rule-state-output.txt`): pre-mech.4 the shop had 6 rules, two of which (`Kurta → category=kurta` priority 102, `Jeans → category=jeans` priority 103) have category effects that don't appear in `SEED_RULES.FASHION`'s codebase definition. Two more (`Linen mention → sub_category=linen` priority 104, `Cotton mention → sub_category=cotton` priority 105) write to `sub_category` axis whereas the equivalent SEED_RULES entries write to `material` axis. The dev shop was apparently hand-customized at some point. **Consequence:** `seedRules()` would write a different rule set than what's actually deployed; future shops onboarded post-3.1.7 will diverge from the dev shop's behavior. **For multi-tenant verification (op debt #50) this is a load-bearing reconciliation** — when does a shop's TaggingRule become out-of-sync with `SEED_RULES`, and what's the canonical-source contract? Cleanup options: (a) update `SEED_RULES.FASHION` to match the dev shop's actual rules (treats deployed state as canonical), (b) reset the dev shop's rules to match SEED_RULES (treats code as canonical, loses any hand-customizations), (c) document divergence as an expected merchant-customization feature (treats SEED_RULES as defaults, not canonical). Decision deferred to 3.1.8 planning round or later. **mech.4's eval-regression finding (broader category coverage hurt the kurta fixture) was a downstream effect of this discrepancy** — the unexpected kurta-rule activation diluted top-6 ranking. Out of 3.1.7 scope.

## 2. Current empirical state

Probe output (`_rule-state-output.txt`, captured 2026-05-14):

**Dev-shop TaggingRule rows: 7 total.**

| Priority | Name | Conditions | Effects |
|---:|---|---|---|
| 100 | Men's in title → gender=male | title_contains "men's" OR tag_contains "men's" | gender=male |
| 101 | Women's in title → gender=female | title_contains "women's" OR tag_contains "women's" | gender=female |
| **102** | **Kurta → category=kurta** | title_contains "kurta" | category=kurta |
| **103** | **Jeans → category=jeans** | title_contains "jeans" | category=jeans |
| **104** | **Linen mention → sub_category=linen** | title_contains "linen" OR tag_contains "linen" | **sub_category=linen** |
| **105** | **Cotton mention → sub_category=cotton** | title_contains "cotton" OR tag_contains "cotton" | **sub_category=cotton** |
| 106 | Shorts category | title_contains "shorts" OR type_equals "shorts" / "men's shorts" / "women's shorts" / "kids shorts" | category=shorts |

**SEED_RULES.FASHION rules: 8 total.**

| Name | Effects |
|---|---|
| Men's products | gender=male |
| Women's products | gender=female |
| Unisex products | gender=unisex |
| Kids products | gender=kids |
| Linen material | material=linen |
| Cotton material | material=cotton |
| Denim material | material=denim |
| Shorts category | category=shorts |

**Divergence summary:**

| Comparison | Dev shop | SEED_RULES |
|---|---|---|
| Gender rules | 2 (male, female only) | 4 (male, female, unisex, kids) |
| Material rules | 0 (linen/cotton write to sub_category) | 3 (linen, cotton, denim) |
| sub_category rules | 2 (linen, cotton — divergent) | 0 |
| Category rules | 3 (kurta, jeans, shorts) | 1 (shorts only) |
| Total | 7 | 8 |

The "Shorts category" rule is the only one with matching names + effects across the two. All other rules diverge in name AND/OR axis target.

**No drift since mech.4.5.** The 6 pre-mech.4 rules are intact; the mech.4 commit added the 7th (Shorts category).

## 3. Scope estimate — what closing this debt requires

The HANDOFF entry names three options:

- **(a) Update SEED_RULES.FASHION to match the dev shop.** Code change. Adds Kurta + Jeans category rules, redirects Linen/Cotton from material → sub_category, removes Unisex + Kids + Denim. ~30 LOC change in `app/lib/catalog/rule-seeds.ts`. Risk: future shops inherit dev-shop hand-customizations as defaults, which may not be appropriate (e.g., "Kurta" is a category specific to Indian-ethnic fashion; not every fashion shop has kurta merchandise).
- **(b) Reset dev shop to match SEED_RULES.** DB-side change. Delete the 6 hand-customized rules; the seedRules() function regenerates the SEED_RULES.FASHION set. Loses hand-customizations. Risk: existing APPROVED rows that came from the hand-customized rules become orphaned (the 200 kurta-tagged products were created by the Kurta rule which would be deleted).
- **(c) Document divergence as expected feature.** Process change. SEED_RULES becomes the default starting point; shops can hand-customize and the divergence is expected. No code or DB changes. Implications for multi-tenant verification (op debt #50): each shop has its own rule set; SEED_RULES is the bootstrap-only-seed, not the canonical state.

**Scope per option:**
- (a): ~30 LOC SEED_RULES update + tests + verification probe. Small-medium mech.
- (b): SQL migration to delete the 6 rules + seedRules() re-invocation + verification + cleanup of the 200 kurta + 53 shorts rows that came from the deleted rules. Medium-large; touches catalog data integrity.
- (c): 0 LOC; ~40 LOC of doc + HANDOFF amendment. Trivial.

## 4. Implementation surface

Per option:
- (a): `app/lib/catalog/rule-seeds.ts`, tests, verification probe.
- (b): Migration SQL + `app/lib/catalog/rule-seeds.ts` invocation flow + cleanup script. NB: per CLAUDE.md migration discipline, this requires hand-written SQL migration file.
- (c): HANDOFF amendment + `app/lib/catalog/rule-seeds.ts` doc comment.

## 5. Eval movement prediction

The divergence itself produced the mech.4 regression (retroactive kurta-rule firing). But the regression is in the PAST — it's already baked into the post-mech.4 eval baseline (0.2917). Reverting the kurta rule's effects (option b path) would restore Stage 1 for the kurta fixture from 202 → 2 candidates, which would lift `fashion-oversized-fit-kurta` from FAIL=0 back to PARTIAL=0.50.

**Per-option eval prediction:**

| Option | Kurta fixture | Net aggregate movement |
|---|---|---:|
| (a) Update SEED_RULES to match dev shop | FAIL=0 (no change; dev shop unchanged) | 0 |
| (b) Reset dev shop to match SEED_RULES | PARTIAL=0.50 (reverts mech.4 dilution); shorts fixture stays FAIL (still 53 candidates from "Shorts category" which IS in SEED_RULES) | +0.0417 |
| (c) Document as feature | FAIL=0 (no change) | 0 |

Option (b) is the only one with eval-positive impact. It effectively undoes mech.4's kurta-rule activation. The trade-off: 200 RULE-tagged kurta APPROVED rows get deleted, dropping the post-mech.4 26% category coverage back to ~17%.

## 6. Coupling to other debts

- **#49 broader category coverage:** strong coupling. Adding new category seeds (path b of #49) requires resolving #51 first — otherwise the new seeds may conflict with or be ignored by the dev shop's hand-customized rules.
- **#43 gender=female:** weak coupling. The dev shop's gender rule (Women's in title → gender=female) is similar to SEED_RULES's Women's products rule. Both effect gender=female. Closing #43 doesn't require resolving #51 first, but a consistent canonical-source decision makes both easier.
- **#50 multi-tenant verification:** load-bearing. The HANDOFF entry explicitly names #50 as the consumer of #51's canonical-source decision. Multi-tenant onboarding can't proceed without a clear answer on "what's the SEED_RULES contract."
- **#52 / #53 / #55 (Thread 3 candidates):** unrelated; ranking-architecture concerns.

#51 is the gating decision for the "catalog-data cluster" (#46, #49, #51). All three couple together for 3.2 planning.

## 7. Triage verdict

**(N) next-sub-bundle** — the implementation is 3.2 territory. But **the planning-round close should name a preferred direction** even if implementation deferred.

Reasoning:
- The flip doesn't depend on the canonical-source decision. v2's pipeline doesn't read SEED_RULES at runtime; the rules are deployed in TaggingRule rows and `applyRules` operates against those.
- The divergence has been quiet since 3.1.7 mech.4.5 surfaced it. There's no production-traffic urgency.
- Implementation is scope-medium (option a or b) or scope-zero (option c).

**Why this matters for the planning-round close (the embedded decision):**

The three options have different implications for Phase 5 multi-tenant onboarding:

- **Option (a)** treats deployed state as canonical. Implies that future shops onboarded via `seedRules()` get the dev-shop hand-customizations as defaults. Bad for shop diversity (kurta isn't appropriate for non-Indian-ethnic shops).
- **Option (b)** treats code as canonical. Implies all shops start with the same baseline, and merchant hand-customizations are layered on top via the portal (Phase 5+). Clean for multi-tenant; lossy for the current dev shop.
- **Option (c)** treats SEED_RULES as defaults. Implies a "starter template" model where shops can deviate. Cleanest for multi-tenant; doesn't recover the mech.4 regression.

**Recommended direction (for planning-round-close to confirm):** option (c) — document divergence as expected merchant-customization feature. SEED_RULES becomes the starter template, not the canonical state. The 3.2 catalog-data cluster work then proceeds as: add more SEED_RULES.FASHION starter rules (for #49's broader category coverage), build the portal UI for merchant rule customization (Phase 4-5), and accept that the dev shop's hand-customized state is a special case representing "shop that did its own thing." Phase 5 multi-tenant verification (op debt #50) explicitly tests new shops onboarded fresh and verifies the SEED_RULES starter set matches their expectations.

Option (c) eval impact = 0 (kurta fixture stays at FAIL=0). But Thread 3's recommendation already deferred kurta-fixture recovery to 3.2's d.2-strict + catalog-data work. So option (c) is consistent with Thread 3's α + 3.2 trajectory.

Option (b) is the only eval-recoverable option but reverses mech.4's APPROVED rows. That's destructive against the catalog audit trail and goes against the "catalog data accumulates forward; we don't roll back tag approvals" pattern.

**Recommendation for the planning-round close:** name option (c) as the preferred direction. Implementation deferred to 3.2 (along with #49). HANDOFF amendment in 3.1.8 close can include a sentence: "Op debt #51 canonical-source decision: SEED_RULES is the starter template, not canonical. Implementation TBD in 3.2."
