# Per-fixture Stage 1 failure mode

Source data: `14-stage-1-per-fixture-output.json` (probe captured
2026-05-09T08:05Z against ai-fashion-store.myshopify.com production DB).

## Catalog snapshot at probe time

| Metric | Value |
|--------|------:|
| Total products in DB | 2,632 |
| ACTIVE + not deleted + not excluded | 1,169 |
| Of those: with embedding NOT NULL | 1,169 |
| **Of those: with at least one variant `availableForSale=true`** | **29** |
| Distinct products with any APPROVED ProductTag | 52 |

**Headline:** the structural Stage 1 universe (the set of products that
pass the always-on filters before any per-axis tag predicate fires) is
**29 products**, not the ~1,169 that "1,169 ACTIVE products" implies.
The cause: 1,140 of the 1,169 ACTIVE products have no
`availableForSale=true` variant.

This is the single most important Thread 2 finding and it was NOT
documented in any prior HANDOFF op debt.

## Per-fixture outcomes

Bucket legend: EMPTY (0 candidates) / SPARSE (1–4 candidates) /
HEALTHY (≥20 candidates) / NO-HARD-FILTER (Stage 1 had nothing to
filter on, returns the full structural universe of 29).

| # | Fixture | Stage 1 active hard-filter axes | Candidates | Bucket | Failing axis |
|---|---------|---------------------------------|-----------:|--------|--------------|
| 1 | fashion-casual-office-shirts | category=[shirt] | 0 | EMPTY | category — 26 catalog products with APPROVED `category=shirt`, but **0 in the 29-universe** |
| 2 | fashion-festive-kurta-women | gender=[female] + category=[kurta] | 0 | EMPTY | gender (0 catalog APPROVED gender=female matches) AND category (2 catalog APPROVED category=kurta matches, 0 in universe) |
| 3 | fashion-going-out-outfit | (none) | 29 | NO-HARD-FILTER | n/a — query extraction surfaced only `occasion=[event]`, which is not a hard-filter axis. Full universe passes. |
| 4 | fashion-linen-shirts-white | category=[shirt] | 0 | EMPTY | category — same as fixture #1 |
| 5 | fashion-minimalist-daily-wear | (none) | 29 | NO-HARD-FILTER | n/a — extracted `occasion=[casual]` + `style_type=[minimal]`, neither hard-filtered |
| 6 | fashion-oos-stress-1 | category=[shirt] | 0 | EMPTY | category — same as fixture #1 |
| 7 | fashion-oos-stress-2 | category=[saree] | 0 | EMPTY | category — **0 catalog products have APPROVED `category=saree` at all** |
| 8 | fashion-oversized-fit-kurta | category=[kurta] | 0 | EMPTY | category — 2 catalog APPROVED, 0 in universe |
| 9 | fashion-show-jackets | category=[jacket] | 0 | EMPTY | category — 5 catalog APPROVED, 0 in universe |
| 10 | fashion-show-trousers | category=[pants] | **1** | SPARSE | category — 8 catalog APPROVED, **1 in universe** (the single candidate `aire-relaxed-elastic-pure-linen-trousers-regal-blue`) |
| 11 | fashion-summer-shorts-size-m | category=[shorts] | 0 | EMPTY | category — **0 catalog products have APPROVED `category=shorts` at all** |
| 12 | fashion-wedding-reception | (none) | 29 | NO-HARD-FILTER | n/a — extracted `occasion=[festive, event]`, neither hard-filtered |

Distribution: 8 EMPTY, 1 SPARSE, 0 HEALTHY, 3 NO-HARD-FILTER.

## Why is fashion-show-trousers the lone PASS?

It's the only fixture where the extracted hard-filter value (`category=pants`)
intersects the 29-universe. That intersection happens to be exactly 1
product. With k=6 and `relaxedMatchAtK = satisfying / max(1, top.length)`,
that 1 product satisfies the single-axis filter (`category=pants`), so:
- relaxedMatchAtK = 1/1 = 1.0
- precisionAtK = 0 (expectedHandles is empty)
- combinedScore = 1.0 × relaxed = 1.0 (empty-handles branch)
- aggregateScore across 12 fixtures = 1.0 / 12 = **0.0833**

The PASS is technically real but mathematically degenerate — it's a 1/1
single-product satisfaction, not a robust top-K match.

## Why do the 3 NO-HARD-FILTER fixtures (29 candidates each) still FAIL?

For these fixtures Stage 1 returns the full 29-universe. Stage 2 (semantic
retrieval) and Stage 3 (re-rank) then pick a top-K. But the relaxed-match
scoring against `expectedTagFilters` requires each surviving top-K product
to have an APPROVED tag on each requested axis. The probe shows:

```
distinctProductsWithApprovedTagPerAxis (catalog-wide):
  gender:           50
  category:         50
  sub_category:     52
  occasion:          0   ← every fixture in this bucket queries occasion
  color_family:      0
  material:          0
  fit:               0
  season:            0
  size_range:        0
  style_type:        0
  sleeve_length:     0
  pattern:           0
  collar_type:       0
  price_tier:        0
  statement_piece:   0
```

Zero products have APPROVED tags on `occasion`, `style_type`, or any
non-(gender, category, sub_category) axis. So all 3 NO-HARD-FILTER
fixtures get relaxedMatchAtK=0 — every top-K product fails the per-axis
satisfaction test because the products have no APPROVED secondary-axis tags.

## Why do the 8 EMPTY fixtures all fail?

Stage 1 returned 0 candidates → top-K is empty → relaxedMatchAtK=0 by
the early-return in scoring.ts:53 (`if (actualWithTags.length === 0)
return 0`). Stage 2-6 don't even run (they receive empty input).

## Dominant failure axis(es)

| Failing pattern | Fixtures affected | Notes |
|-----------------|------------------:|-------|
| **Structural universe gap** (Stage 1 universe = 29 of 1,169 ACTIVE) | 8 of 12 EMPTY fixtures | Even when 8-26 catalog products have an APPROVED `category` tag matching, the structural availability filter eliminates all of them |
| **Vocabulary gap** (no APPROVED tag with the required value exists at all) | 2 of 12 (saree, shorts) | Catalog has 0 APPROVED `category=saree` or `category=shorts` products. PR-2.2 calibration sample skewed innerwear (op debt #10) |
| **Secondary-axis APPROVED gap** (occasion / color_family / material / fit / season / size_range / style_type all at 0% APPROVED) | 11 of 12 (every fixture except show-trousers, which only queries category) | Even healthy Stage 1 + Stage 2 output cannot satisfy multi-axis relaxed match |

## Cross-reference: failing axes vs low-coverage axes

YES — the failing axes ARE the low-coverage axes, but the relationship is
deeper than expected.

The bulk-approve at mech.6 baseline approved (gender, category) on 50
products → 50 APPROVED gender + 50 APPROVED category at the catalog level.
But those 50 products are not the same set as the 29-universe. The
overlap is approximately 1 product (the trousers).

So even on the axes that ARE bulk-approved, the gap between catalog-level
APPROVED count and Stage 1 universe-eligibility is the load-bearing
constraint. Bulk-approving more axes wouldn't help unless the calibration
sample is re-targeted at structurally-eligible products (or unless the
catalog's `availableForSale` flag is fixed for the 1,140 products that
fail the variant filter).
