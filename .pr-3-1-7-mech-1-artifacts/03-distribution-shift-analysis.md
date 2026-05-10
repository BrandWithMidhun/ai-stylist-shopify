# Probe-stage-1 distribution shift: pre-mech.1 → post-mech.1

**Source baselines:**
- **Pre-mech.1 (Thread 2):** `.pr-3-1-7-planning-artifacts/14-stage-1-per-fixture-output.json`, captured 2026-05-09T08:05:03Z by Thread 2's investigation.
- **Post-mech.1 (this verification):** `.pr-3-1-7-mech-1-artifacts/01-probe-stage-1-post-mech-1.json`, captured 2026-05-10T07:31:40Z, after `bbc79d1` (PR-3.1.7-mech.1).

**Eval baseline:** `.pr-3-1-7-mech-1-artifacts/02-eval-post-mech-1.txt` (EvalRun `cmozgj11v0000q73shz5w7t5g`).

---

## Universe-level metrics

| Metric | Pre-mech.1 | Post-mech.1 | Notes |
|--------|-----------:|------------:|-------|
| Total products in DB | 2,632 | 2,632 | Catalog unchanged |
| ACTIVE + not-deleted + not-excluded | 1,169 | 1,169 | Catalog unchanged |
| Of those: with embedding NOT NULL | 1,169 | 1,169 | All embedded since 3.1.6 α backfill |
| **Stage 1 input universe** | 29 | **1,169** | **mech.1 D1 lifted the variant filter** |
| Products with at least one available variant | 29 | 29 | Preserved as historical metric (was the pre-mech.1 cap; is now the count Stage 6 will surface as `available=true`) |
| Distinct products with any APPROVED tag | 52 | 52 | Catalog tagging unchanged (mech.3 lifts this) |

**Probe metric rename note:** the probe's `stage1UniverseStructural` field (which measured Stage-1-input-with-variant-filter) was renamed in this verification run to `productsWithAvailableVariant` to be honest about what it counts; the new field `stage1InputAfterMech1` reports the actual post-mech.1 Stage 1 input count. See `04-probe-update-note.md` for the rename rationale.

---

## Per-fixture grid

Bucket key: EMPTY (0 candidates) / SPARSE (1–4) / HEALTHY (5–999) / CAPPED (1000, hit Stage 1's LIMIT 1000 because no per-axis filter narrowed the universe).

| # | Fixture | Hard filters | Pre-mech.1 | Post-mech.1 | Bucket shift | Catalog APPROVED match |
|---|---------|--------------|-----------:|------------:|--------------|----------------------:|
| 1 | fashion-casual-office-shirts | category=shirt | 0 | **26** | EMPTY → HEALTHY | 26 |
| 2 | fashion-festive-kurta-women | gender=female + category=kurta | 0 | **0** | EMPTY → EMPTY | gender=0, category(kurta)=2 |
| 3 | fashion-going-out-outfit | (none) | 29 | **1000** | NO-HARD-FILTER → CAPPED | n/a |
| 4 | fashion-linen-shirts-white | category=shirt | 0 | **26** | EMPTY → HEALTHY | 26 |
| 5 | fashion-minimalist-daily-wear | (none) | 29 | **1000** | NO-HARD-FILTER → CAPPED | n/a |
| 6 | fashion-oos-stress-1 | category=shirt | 0 | **26** | EMPTY → HEALTHY | 26 |
| 7 | fashion-oos-stress-2 | category=saree | 0 | **0** | EMPTY → EMPTY | 0 (vocabulary gap) |
| 8 | fashion-oversized-fit-kurta | category=kurta | 0 | **2** | EMPTY → SPARSE | 2 |
| 9 | fashion-show-jackets | category=jacket | 0 | **5** | EMPTY → HEALTHY | 5 |
| 10 | fashion-show-trousers | category=pants | 1 | **8** | SPARSE → HEALTHY | 8 |
| 11 | fashion-summer-shorts-size-m | category=shorts | 0 | **0** | EMPTY → EMPTY | 0 (vocabulary gap) |
| 12 | fashion-wedding-reception | (none) | 29 | **1000** | NO-HARD-FILTER → CAPPED | n/a |

Per-fixture candidate counts now match catalog APPROVED counts exactly (mod the Stage 1 LIMIT 1000 cap on no-hard-filter fixtures). Universe relocation landed cleanly.

---

## Bucket distribution

| Bucket | Pre-mech.1 | Post-mech.1 |
|--------|-----------:|------------:|
| EMPTY (0 candidates) | 8 | 3 |
| SPARSE (1–4 candidates) | 1 | 1 |
| HEALTHY (5–999 candidates) | 0 | 5 |
| CAPPED (1000) | 0 | 3 |
| NO-HARD-FILTER (universe-bound at 29) | 3 | 0 |

5 fixtures moved out of EMPTY into HEALTHY; 1 fixture moved from SPARSE to HEALTHY; 3 fixtures moved from NO-HARD-FILTER (29-cap) to CAPPED (1000-cap, the Stage 1 LIMIT).

The 3 fixtures still EMPTY:
- **fashion-festive-kurta-women** (gender=female + category=kurta): blocked by `gender=female` having 0 catalog APPROVED rows. The bulk-approve from mech.6 baseline-prep flipped 50 PENDING gender tags but apparently none of them are `female`. Mech.3 will not address this directly (it bulk-approves secondary axes, not gender values); this fixture needs gender-vocabulary expansion or a re-targeted bulk-approve.
- **fashion-oos-stress-2** (category=saree) and **fashion-summer-shorts-size-m** (category=shorts): vocabulary gaps — 0 catalog APPROVED rows for these category values. Mech.4 (conditional in 3.1.7 plan) is the explicit lever.

---

## Eval baseline shift

| Metric | Pre-mech.1 (HANDOFF line 645) | Post-mech.1 (this run) |
|--------|------------------------------:|-----------------------:|
| EvalRun ID | `cmowtdm120000q7io6bzxu1sa` | `cmozgj11v0000q73shz5w7t5g` |
| pipelineVersion | 3.1.0 | 3.1.0 |
| totalQueries | 12 | 12 |
| pass / partial / fail | 1 / 0 / 11 | **2 / 0 / 10** |
| **aggregateScore** | **0.0833** | **0.1667** (2× lift) |
| durationMs | 11,697 | 19,593 |

**The new PASS is `fashion-show-jackets`** (relaxed=1.00). Pre-mech.1 it was FAIL because all 5 catalog APPROVED `category=jacket` products were outside the 29-universe (no available variants). Post-mech.1 the universe expansion makes all 5 visible to Stage 2 → Stage 3 → top-K, which trivially satisfies the single-axis `expectedTagFilters: { category: ["jacket"] }` filter.

`fashion-show-trousers` PASS persists (8 candidates instead of 1, but relaxed-match-only single-axis filter still satisfies trivially).

The 10 remaining FAILs all share the same shape: their `expectedTagFilters` includes one or more secondary axes (occasion, color_family, material, fit, season, size_range, style_type) where catalog-wide APPROVED count is **0%**. relaxedMatchAtK requires each top-K product to have an APPROVED tag on every requested axis; with 0% APPROVED on the requested secondary axes, relaxed=0 by construction.

`fashion-festive-kurta-women`, `fashion-oos-stress-2`, `fashion-summer-shorts-size-m` additionally short-circuit with 0 candidates from Stage 1 (per the EMPTY bucket above).

---

## Findings

- **mech.1 universe expansion: PASS.** Stage 1 input lifted from 29 → 1,169. Per-fixture candidate counts confirm the variant filter is no longer applied at Stage 1.
- **Eval lift: 0.0833 → 0.1667** (delta +0.0833, doubled). Attributable entirely to `fashion-show-jackets` flipping FAIL → PASS now that its 5 APPROVED-jacket products clear Stage 1.
- **Per-fixture per-axis bottlenecks remaining (mech.3 / mech.4 targets):**
  - **Mech.3 targets** (secondary-axis APPROVED gap, blocking 7 fixtures from PARTIAL/PASS even with healthy Stage 1 candidate pools): casual-office-shirts (occasion + style_type), going-out-outfit (occasion + style_type), linen-shirts-white (color_family + material), minimalist-daily-wear (style_type + occasion), oos-stress-1 (color_family + material), oversized-fit-kurta (fit), wedding-reception (occasion).
  - **Mech.4 targets** (vocabulary gap, 0 catalog APPROVED for the requested category value): oos-stress-2 (saree), summer-shorts-size-m (shorts).
  - **Out-of-mech.3-scope** (gender-value vocabulary gap, not a secondary-axis problem): festive-kurta-women (gender=female has 0 APPROVED). Surfaced as op-debt-candidate at sub-bundle close; not fixable by mech.3's `--axes=occasion,color_family,material,fit,season,size_range,style_type` invocation.
- **Surface for mech.3.5 verification:** 7 fixtures should move from FAIL → PARTIAL/PASS post-mech.3, lifting aggregateScore into the 0.30–0.50 range Thread 3 predicted (artifact `23` per-fixture grid). 2 fixtures (saree, shorts) and 1 fixture (festive-kurta-women) require mech.4 / out-of-scope work to move further.
- **Diagnostic separability achieved:** future post-mech.3 eval rerun can attribute its lift entirely to secondary-axis APPROVED coverage, not to universe expansion.
