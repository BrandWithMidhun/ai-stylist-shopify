# Artifact 21 — Op debt #43 assessment: gender=female axis at 0% APPROVED

## 1. Verbatim re-pull (HANDOFF.md:721)

> 43. `gender=female` axis is 0%-APPROVED catalog-wide on the dev shop (surfaced in mech.1.5's distribution-shift analysis as a third 0%-APPROVED axis beyond mech.3's secondary-axis target list and mech.4's saree/shorts vocabulary gap). Blocks the `fashion-festive-kurta-women` fixture from passing. Out of mech.3 scope (mech.3 covers occasion / color_family / material / fit / season / size_range / style_type, not gender). Out of mech.4 scope (mech.4 is category-axis vocabulary expansion). Revisit at 3.1.7 close (mech.5) or 3.1.8 planning round.

## 2. Current empirical state

Probe output (`.pr-3-1-8-planning-artifacts/_catalog-state-output.txt`, captured 2026-05-14):

```
== #43 gender axis state ==
  status=PENDING_REVIEW value=male: 1 rows
  status=APPROVED value=male: 49 rows
  status=APPROVED value=unisex: 1 rows
  Distinct products with APPROVED gender: 50
  Distinct products with APPROVED gender=female: 0
```

**No drift since 3.1.7.** 0 catalog-wide products carry APPROVED `gender=female`. The 50 APPROVED gender rows skew entirely to male (49) and unisex (1).

Fixture impact — fixtures with `gender` in their `expectedTagFilters`:
- `fashion-festive-kurta-women` — `expectedTagFilters.gender = ["female"]`. Stage 1 returns 0 candidates (mech.3.5 + mech.4.5 verdict EMPTY_STAGE_1, re-confirmed in Thread 3 artifact 13).

No other current fixture queries `gender=female`. Inventory of the 12 fixtures (Thread 3 artifact 13):
- `fashion-festive-kurta-women` is the only fixture whose `expectedTagFilters` references gender. All other fixtures' expected filters are category/color/material/fit/season/occasion/style_type/size_range.

## 3. Scope estimate — what closing this debt requires

The HANDOFF amendment for op debt #43 names the rule-engine seed path: a `title_contains "women" → gender=female` rule (or similar). The rule-state probe (`_rule-state-output.txt`) shows:

- Dev shop's TaggingRule table currently has a `Women's in title → gender=female` rule (priority 101) that fires on `title_contains "women's"` OR `tag_contains "women's"`.
- SEED_RULES.FASHION has a "Women's products" rule with the same effect but different condition pattern (`title_contains "women's"` vs `title_contains "women's"` — same string).

The rule EXISTS in the dev shop's TaggingRule table. But it has never been APPLIED to the catalog with `--axes=gender`. The mech.4 `apply-rules-to-shop.ts --axes=category` invocation only fired category-effect rules; it didn't touch the gender rule.

**Closing #43 requires:**
1. Run `apply-rules-to-shop.ts --shop=ai-fashion-store.myshopify.com --axes=gender` (existing script, no source changes; ~0 LOC).
2. Verify the resulting ProductTag rows include `gender=female` entries (probe artifact ~30 LOC).
3. Re-run eval; expect `fashion-festive-kurta-women` to unblock at Stage 1 if at least one product matches `title_contains "women's"`.

Open question for scope: how many dev-shop products have "women's" in title? The probe didn't measure this directly. Likely small (the dev shop has only 1 APPROVED unisex tag and 49 male tags, suggesting most products either have men's titles or no gendered title). If the count is 0, #43 stays blocked even after the rule fires — there's nothing to tag.

## 4. Implementation surface

- **Script:** `scripts/apply-rules-to-shop.ts` (exists, parameterized). No source changes.
- **Verification probe:** ~30 LOC `_probe-gender-rule-apply.ts` (similar to mech.4.5 pattern).
- **Eval rerun:** `npx tsx scripts/run-eval.ts --all`.
- **Files touched in source code:** none (rule is already in DB; script is already parameterized).

## 5. Eval movement prediction

Conditional on whether dev shop has products matching `title_contains "women's"`:

- **If ≥3 products match AND have APPROVED kurta + APPROVED festive occasion:** `fashion-festive-kurta-women` could move from EMPTY_STAGE_1 to PARTIAL or PASS. The fixture's expectedTagFilters require `category=kurta AND gender=female AND occasion=festive`. All three axes must be APPROVED on at least 3 satisfying products for the fixture to PARTIAL (3/6 = 0.50 threshold).
- **If <3 products match:** Stage 1 returns <3, fixture scores up to 1/N (e.g., 1/2 = 0.50 if 2 candidates, 1 satisfying).
- **If 0 products match `title_contains "women's"`:** no change.

Aggregate eval movement: 0 to +0.08 depending on the catalog match count. Lower bound 0 means #43 closure may produce ZERO eval movement (which would surface as a structural carry-forward for 3.2).

## 6. Coupling to other debts

- **#49 broader category coverage:** weak coupling. The kurta-women fixture also depends on `category=kurta`, which is already APPROVED on 202 products post-mech.4. Independent of #43.
- **#50 multi-tenant verification:** #43's `title_contains "women's"` rule pattern is fashion-specific (gendered apparel). Other store modes have different gender semantics or none at all. Phase 5 territory.
- **#51 SEED_RULES divergence:** the dev shop's `Women's in title` rule diverges in naming from SEED_RULES.FASHION's `Women's products`. Both have the same effect; the only divergence is name + condition wording. Closing #43 doesn't require resolving #51 first, but the canonical-source question (#51) overlaps.
- **#55 deferred architectural finding:** the kurta-women fixture is one of the EMPTY_STAGE_1 fixtures in Thread 3 artifact 13's inventory. #43 closure could unblock it. Marginal coupling to d.2-strict (which Thread 3 puts in 3.2).

No tight coupling. Closure is independently shippable.

## 7. Triage verdict

**(N) next-sub-bundle.**

Reasoning:
- The flip itself doesn't depend on #43. v2's pipeline handles `gender=female` queries identically to any other gender query; the gap is data-side (no APPROVED `gender=female` rows), not code-side.
- Real-merchant traffic post-flip will exercise gender-extracted queries on shops with gendered merchandise. The dev shop's gender skew (49 male, 0 female) is dev-shop-specific. Fixing the dev shop alone via rule application is calibration-style work, not flip-prerequisite work.
- Closing #43 is genuinely cheap (~0 LOC, single script invocation, ~30 LOC verification probe). The (B) bundle-with-flip verdict was the predicted upgrade path.

**Why NOT bundle-with-flip (B):**
- Bundling #43 with the flip adds 1 mech (gender-rule-apply) + 1 verification mech (gender-rule-apply.5) = 2 mechs.
- The eval movement is uncertain (could be 0). Thread 3's preliminary mech decomposition (~5 mechs) for 3.1.8-α is already approaching the 3.1.7 sub-bundle scope ceiling. Adding more mechs without proportional eval value violates the discipline pattern of "small focused sub-bundles."
- The fashion-festive-kurta-women fixture has been failing since pre-3.1.7. Carrying it forward one more sub-bundle isn't a regression.
- If the planning-round close prefers a smaller scope (Thread 3's recommendation), #43 is the cleanest debt to defer.

**Upgrade conditions that would shift to (B):**
- If real-merchant onboarding has a women's-fashion-heavy shop ready in the 3.1.8 timing window, the gender-rule-apply pass becomes shop-onboarding-kit work that should ship in 3.1.8 to validate the flow.
- If the planning round prefers visible eval-progress signals in 3.1.8 over discipline (e.g., R3.1 = 0.30+ as a forward-looking signal rather than 0.2917 floor), bundling #43 + #49 + #51 (the canonical-source decision) could collectively lift eval enough to register.

Default verdict: **(N).** Specifically carries to 3.2 in the "catalog-data cluster" (paired with #46, #49, #51 — Thread 2 synthesis Section 5).
