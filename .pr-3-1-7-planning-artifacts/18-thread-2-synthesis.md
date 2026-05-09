# Thread 2 synthesis — Stage 1 behavior under sparse APPROVED tags

HEAD: `e48e079` (3.1.6 close). Investigation: read-only.
Probe: `.pr-3-1-7-planning-artifacts/probe-stage-1.ts` ran against
production DB (`ai-fashion-store.myshopify.com` via Railway proxy) at
`2026-05-09T08:05:03Z`. No DB writes; only Stage 1 + ProductTag
aggregate reads.

## Premise corrections

**1. The bottleneck is the structural variant filter, not APPROVED tag
sparsity.** The resume prompt's framing ("APPROVED-tag coverage is THE
bottleneck") is half right. The deeper bottleneck is that
**stage1UniverseStructural = 29 out of 1,169 ACTIVE+embedded products**.
The variant `availableForSale=true` EXISTS predicate eliminates 1,140
products before any tag predicate fires. Even bulk-approving every
tag-axis to 100% wouldn't unlock more than 29 candidates. This finding
is NOT in any HANDOFF op debt — it's new this thread.

**2. The eval-invariance has TWO causes, not one.** Two compounding
gaps make 11/12 fixtures FAIL:

  (a) Stage-1 universe gap: only 29 products survive the structural
      filters; only ~1 of those 29 has an APPROVED `category` tag with
      a fixture-extracted value (the trousers).

  (b) Secondary-axis APPROVED gap: `occasion`, `color_family`,
      `material`, `fit`, `season`, `size_range`, `style_type` ALL have
      0% APPROVED at the catalog level. Every fixture except show-
      trousers and show-jackets queries at least one of these axes.
      Even if Stage 1 returned the full universe of 29, relaxedMatchAtK
      would still be 0 because the surviving products have no APPROVED
      tags on those axes.

**3. The single PASS (fashion-show-trousers) is mathematically
degenerate.** Stage 1 returns exactly 1 candidate (the lone product
where `category=pants` APPROVED ∩ 29-universe is non-empty). With k=6
and 1 surviving product, relaxedMatchAtK = 1/1 = 1.0. With
expectedHandles empty, combinedScore = 1.0 × relaxed = 1.0.
aggregateScore = 1.0 / 12 = 0.0833. The PASS is real, but it would
disappear if Stage 1 ever returned 0 trouser candidates and would
weaken to <1.0 if it returned 2+ and they didn't all match.

**4. Fixture vocabulary gaps:** `category=saree` and `category=shorts`
have 0 APPROVED catalog products at all. Even un-doing the universe
filter wouldn't help these 2 fixtures — nothing in the catalog has been
APPROVED for those values. PR-2.2 calibration sample skewed innerwear
(this matches HANDOFF op debt #10).

## Question 1 — Per-fixture Stage 1 outcome distribution

| Bucket | Count | Fixtures |
|--------|------:|----------|
| EMPTY (0 candidates) | 8 | casual-office-shirts, festive-kurta-women, linen-shirts-white, oos-stress-1, oos-stress-2, oversized-fit-kurta, show-jackets, summer-shorts-size-m |
| SPARSE (1–4 candidates) | 1 | show-trousers (1 candidate) |
| HEALTHY (≥20 candidates) | 0 | — |
| NO-HARD-FILTER (29 candidates, full universe) | 3 | going-out-outfit, minimalist-daily-wear, wedding-reception |

Detail in artifact `15`.

## Question 2 — Dominant failure axis(es)

Two failure modes, both led by `category`:

**a. Hard-filter axis (Stage 1):** `category` is the only hard-filter
axis active in 8/12 fixtures. The single fixture with both hard-filter
axes active (festive-kurta-women: `gender` + `category`) hits a third
gap — gender-specific catalog APPROVED count is 0 catalog-wide for
`gender=female` (the bulk-approve flipped 50 PENDING gender tags but
the AXIS_OPTIONS values include `male`/`female`/`unisex` — coverage
distribution within those values is unknown to this probe but at least
0 are female; this could indicate the 50 calibration sample is all-male
or all-unisex).

**b. Relaxed-match axes (Stage 6 scoring):** every fixture except
`show-jackets` and `show-trousers` queries axes whose catalog-wide
APPROVED count is 0: `occasion` (6 fixtures), `style_type` (3),
`color_family` (2), `material` (2), `fit` (1), `season` (1),
`size_range` (1).

So the "dominant axis" depends on what's measured:
- For Stage 1 candidate-set arithmetic: **category**
- For Stage 6 relaxed-match scoring: **occasion** (most-queried zero-
  APPROVED axis)

## Question 3 — Catalog coverage per axis

From probe (catalog-wide distinct products with APPROVED tag on axis):

| Axis | APPROVED products | % of ACTIVE | Note |
|------|------------------:|------------:|------|
| gender | 50 | 4.3% | Bulk-approved at mech.6 baseline |
| category | 50 | 4.3% | Bulk-approved at mech.6 baseline |
| sub_category | 52 | 4.4% | Side effect of bulk-approve operations |
| occasion | 0 | 0.0% | 80 PENDING_REVIEW pending |
| color_family | 0 | 0.0% | 52 PENDING |
| material | 0 | 0.0% | 51 PENDING |
| fit | 0 | 0.0% | 51 PENDING |
| season | 0 | 0.0% | 59 PENDING |
| size_range | 0 | 0.0% | 59 PENDING |
| style_type | 0 | 0.0% | 52 PENDING |
| sleeve_length, pattern, collar_type, price_tier, statement_piece | 0 | 0.0% | 17–52 PENDING each |

**<30% APPROVED:** every single axis. The "<30%" threshold is met
universally — there is no well-covered axis. Even gender/category at
4.3% are well below it.

**The 50-sample calibration overlaps the 29-universe at ~1 product.**
That's the load-bearing finding. Bulk-approving more axes for the
existing 50 sample wouldn't help unless the calibration is reseeded
against the products that survive the structural variant filter.

Detail in artifact `16`.

## Question 4 — Failing axes vs low-coverage axes (cross-reference)

YES, they coincide. Every axis a fixture asks about has 0% APPROVED
coverage outside (gender, category, sub_category). This is consistent
with the eval-invariance datapoint and with HANDOFF op debt #10
(calibration sample skewed innerwear).

But the cross-reference reveals a deeper layered structure:
- **Layer 1 (Stage 1 inflow):** 29-universe limits any fixture's max
  candidate count.
- **Layer 2 (Stage 1 hard-filter):** category-axis APPROVED ∩ 29-
  universe is empty for 8/12 fixtures, ≥20 for 0/12 fixtures, =1 for
  1/12 fixtures.
- **Layer 3 (Stage 6 relaxed match):** even when Stage 1 produces
  candidates (the 3 NO-HARD-FILTER fixtures), all secondary axes
  produce relaxed=0 because no catalog product has APPROVED occasion/
  color/material/fit/season/size/style tags.

Each layer alone is sufficient to lock aggregateScore ≤ 0.0833. Fixing
any one layer in isolation would not move the needle — all three need
some progress in parallel.

## Question 5 — Soften viability (Thread 3 option (b))

**Option (b) "soften Stage 1" needs scope clarification before it's
implementable as a small mech.** Three possible meanings:

  (b.i) **Drop the hard-filter category predicate** when Stage 1 would
        return 0 candidates. Falls back to the full 29-universe and
        lets Stage 2 (semantic retrieval) prune. **Cheap to implement**
        (~1 mech: empty-result short-circuit → second-pass query
        without the per-axis predicate). But: **does not improve
        aggregateScore** because Layer 3 (zero APPROVED secondary-axis
        tags) keeps relaxed=0 for every fixture except show-jackets
        and show-trousers (which only need category — and category is
        the very axis being softened).

  (b.ii) **Drop the structural `availableForSale` filter and use a
         post-Stage-5 OOS substitution instead.** Unlocks 1,169
         products into the universe → Stage 2 can rank against the
         full embedded set → Stage 5 substitutes OOS items at output
         time. **Medium-large mech** (~2-3 mechs: filter relocation,
         Stage 5 substitution logic, end-to-end OOS-stress fixture
         re-validation). Would address Layer 1 directly. But: the
         OOS-substitute architectural concern was deliberately
         deferred at mech.5 close (HANDOFF op debt #11) — this option
         re-opens that scope.

  (b.iii) **Soften the per-axis APPROVED requirement** by accepting
          PENDING_REVIEW tags as a tie-breaker when APPROVED yields
          empty results. Strictly forbidden in current design (Stage 1
          file comment: "APPROVED-only ProductTag filter:
          PENDING_REVIEW and REJECTED tags are merchant-undecided /
          merchant-rejected, so Stage 1 must not act on them"). This
          would invalidate the mech.6 design contract. **Mech-scope
          unclear** because it requires re-litigating a locked
          decision. Likely not a 3.1.7 option.

**Recommendation for Thread 3:** option (b) as written is ambiguous.
If the planning round picks (b), it should specify which sub-variant
(b.i / b.ii / b.iii). Of the three, (b.i) is smallest and weakest;
(b.ii) is largest and most impactful; (b.iii) crosses a design line.

## Question 6 — Threshold validity (R3 = 0.0833)

R3 is currently a no-op release gate. It was set TO the empirically
observed value, so any build that doesn't actively regress Stage 1
arithmetic will satisfy it. The threshold lock makes sense as a
"don't backslide" floor but provides no quality signal for the flip
decision.

The harder question — "should the flip ship at aggregateScore 0.0833?"
— is product, not gate. From the data: 1 PASS / 11 FAIL means 11 of 12
canonical user intents would either return 0 candidates or fail
relaxed-match at user-visible top-K. That's a product-level
"ship-as-is" decision the planning round should weigh on its merits,
not gate-clear via R3.

If a sub-bundle needs to revise R3 mechanically (per HANDOFF line
423), the simplest correct revision is to convert R3 from "= 0.0833"
to a target ladder tied to fixture-pass-rate (e.g., R3.1 = 0.30 after
fixing variant filter, R3.2 = 0.60 after secondary-axis APPROVED, etc.).
This keeps the floor concept while making it informative.

Detail in artifact `17`.

## Question 7 — Premise corrections (catch-all)

In addition to corrections 1–4 above:

**5. Stage 1's "soften" surface is narrow.** Per `HARD_FILTER_AXES`
(`store-axes.ts:36`), only FASHION mode hard-filters anything
(`gender`, `category`). All other store modes have empty hard-filter
lists. Softening Stage 1 only affects FASHION recommendations; it
doesn't change the contract for ELECTRONICS / FURNITURE / BEAUTY /
JEWELLERY / GENERAL. Phase 5 will populate per-mode hard-filter axes
when those modes get calibrated.

**6. Test coverage for Stage 1 is structural, not behavioral.** All
six tests in `stage-1-hard-filters.test.ts` mock `prisma.$queryRawUnsafe`
and assert on the SQL string. Zero tests validate that the SQL would
return non-empty results against a real catalog. This explains why a
Stage 1 implementation that returns 0 candidates for 8/12 production
fixtures still passes its own test suite. Any soften option that
changes Stage 1 logic will need behavioral tests against real data
(or a stable seeded test catalog) to validate the change actually
moves candidate counts.

**7. Variant filter relocation has a CASCADING effect.** Moving the
`availableForSale` predicate out of Stage 1 (as in option b.ii) would
unlock the structural universe for ALL fixtures, BUT also for ALL
production chat traffic. Today, recommend_products tool-call results
exclude OOS products from the agent's slim summary; if Stage 1 stops
filtering them, Stage 5/6 (and the v2 tool stub) would need to either
filter or surface OOS products with `available=false`. This couples
to op debt #15 (Thread 1 finding: v2 ProductCard already ships with
`available=true` placeholder). The two threads' findings interact:
the variant-loading mech (#15) and any Stage 1 universe fix (Thread 2)
should be planned together if both ship in 3.1.7.
