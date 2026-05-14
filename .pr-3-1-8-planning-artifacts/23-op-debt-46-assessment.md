# Artifact 23 — Op debt #46 assessment: size_range AI-tagger reliability gap

## 1. Verbatim re-pull (HANDOFF.md:724)

> 46. `size_range` axis AI-tagger reliability: 75% (44/59) of PENDING_REVIEW size_range tags were sub-0.8 confidence (per `.pr-3-1-7-mech-3-artifacts/_confidence-inspection.txt`). Compares against ~7-23% sub-0.8 on the other six secondary axes (occasion 17.5%, color_family 7.7%, material 0%, fit 23.5%, season 18.6%, style_type 13.5%). Cause is likely the AI-tagger inferring sizes from product titles without sizing-chart data — a structural reliability gap in the tagger, not a bulk-approve issue. mech.3 approved only 15/59 size_range tags (the high-confidence 25%); 44 remain PENDING_REVIEW. Revisit when AI-tagger gains structured size data (sizing-chart parsing, variant-option introspection, or merchant-input-driven sizing schemas). Out of 3.1.7 scope.

## 2. Current empirical state

Probe output (`_catalog-state-output.txt`):

```
== #46 size_range AI-tagger reliability ==
  Total size_range rows: 59
  APPROVED:               15
  PENDING_REVIEW:         44
  REJECTED:               0
  Distinct products with APPROVED size_range: 3
  PENDING_REVIEW sub-0.8 confidence: 44/44 (100.0%)
```

**No drift since 3.1.7 mech.3.**

Interpretation: the 59 total size_range rows split exactly as HANDOFF described — 15 high-confidence (approved by mech.3a's `--min-confidence=0.8` flag) + 44 low-confidence (all sub-0.8, remaining as PENDING_REVIEW).

Distinct-product count: 3. The 15 APPROVED rows are clustered on 3 products with multiple size values each (e.g., one product carrying `size_range=s`, `size_range=m`, `size_range=l` → 3 rows on 1 product).

Fixture impact — fixtures requiring size_range:
- `fashion-summer-shorts-size-m` — `expectedTagFilters.size_range = ["m"]`. Thread 3 artifact 13 verdict: NO_SATISFYING_IN_CATALOG_POOL (Stage 1 returns 53 candidates from the mech.4 shorts rule, but 0 satisfy because the 3 size_range-tagged products are likely not in the 53-shorts pool).

No other fixture's expectedTagFilters includes size_range.

## 3. Scope estimate — what closing this debt requires

The HANDOFF entry frames this as "AI-tagger reliability gap" — a structural limitation of the current AI-tagger when product titles don't carry size signals. The fix path requires either:

- **(a) AI-tagger re-prompt for size_range** with explicit sizing-chart input. Probably ~50-100 LOC in the AI-tagger prompt + integration with variant-option introspection. Not a small mech.
- **(b) Manual / bulk-approve of the 44 PENDING_REVIEW sub-0.8 rows.** Lowers the confidence threshold for size_range specifically. Risk: poor-quality APPROVED tags.
- **(c) Variant-option introspection.** Read `ProductVariant.title` or `ProductVariant.option1/2/3` to derive size_range tags. ~80 LOC + 5-10 tests. Structurally cleaner.
- **(d) Defer to merchant-input-driven sizing schemas.** Phase 5 onboarding territory.

mech.3a's `--min-confidence=0.8` flag was the calibration response: don't approve unreliable AI-tagger output. The flag is now load-bearing for the bulk-approve script's quality contract. Lowering the threshold for size_range alone violates the calibration discipline.

Estimated scope for proper closure: medium-to-large mech (~100+ LOC + extensive tests).

## 4. Implementation surface

Most promising path (option c — variant-option introspection):
- **New module:** `app/lib/catalog/variant-size-extractor.server.ts`. Reads `ProductVariant.option1` / `option2` / `option3` and matches against `AXIS_OPTIONS.FASHION.size_range.values`. ~80 LOC.
- **Integration:** rule-engine or AI-tagger pipeline calls the extractor and writes APPROVED `size_range` tags directly (source="VARIANT" or similar).
- **Schema:** if a new `source` value is needed, Prisma migration (small).
- **Tests:** unit tests for the extractor + integration tests for the apply-flow. ~5-10 tests.

## 5. Eval movement prediction

Conditional on whether the closed #46 produces APPROVED size_range tags on products that also have APPROVED `category=shorts` AND `season=summer`:

- The fixture `fashion-summer-shorts-size-m` requires `category=shorts AND season IN {summer, all_season} AND size_range=m`. Per Thread 3 artifact 13, the 53 shorts have 0 satisfying products (no overlap on size_range).
- If #46 closure adds size_range=m APPROVED rows to at least 3 of the 53 shorts → fixture could move from 0 to 3/6 = 0.50 PARTIAL.
- If size_range tags land on fewer than 3 of the 53 shorts → fixture stays in FAIL bucket.

Aggregate eval movement: 0 to +0.04 depending on catalog overlap.

The eval impact is structurally limited because only 1 fixture queries size_range. Closing #46 doesn't help the other 11 fixtures.

## 6. Coupling to other debts

- **d.2-strict (Thread 3 recommendation for 3.2):** d.2-strict requires Stage 1 hard-filter on extracted query axes. For the shorts-size-m fixture, that means filtering on size_range=m at Stage 1. If size_range coverage stays at 3 distinct products, d.2-strict would shrink Stage 1 to those 3 (if they overlap with shorts) or 0 (if no overlap). **Closing #46 BEFORE d.2-strict ships in 3.2 unlocks the shorts-size-m fixture.** Otherwise d.2-strict empties Stage 1 for this fixture.
- **#49 broader category coverage:** weak coupling; shorts category already at 53 APPROVED, so #46's bottleneck is size_range alone.
- **#47 bulk-mutation Railway-proxy stability:** unrelated (operational concern).
- **#50 multi-tenant verification:** size_range semantics differ across modes (e.g., FURNITURE's "small/medium/large" sofa sizes have nothing in common with FASHION sizes). Phase 5 multi-mode work.

**Tight coupling to d.2-strict.** If 3.2 ships d.2-strict, #46 closure should be paired or sequenced.

## 7. Triage verdict

**(N) next-sub-bundle** (specifically 3.2 alongside d.2-strict).

Reasoning:
- The flip doesn't depend on #46. v1 has the same blind spot (it doesn't use size_range either; it's a v2 stage's input axis).
- The fix is medium-scope (~100 LOC) and structurally couples to d.2-strict's d.2-strict-for-shorts behavior.
- Eval impact is limited (1 fixture; max +0.04).

**Why NOT bundle-with-flip (B):**
- Scope is too large for a 3.1.8 bundle (~100 LOC + new module + tests). Discipline pattern: 3.1.8 stays focused on the flip; medium-large mechs carry to 3.2.
- The eval impact alone doesn't justify the scope unless paired with d.2-strict (which is 3.2 territory per Thread 3).

**Recommendation:** carry to 3.2; pair sequencing with d.2-strict so the shorts-size-m fixture isn't structurally empty after d.2-strict ships.
