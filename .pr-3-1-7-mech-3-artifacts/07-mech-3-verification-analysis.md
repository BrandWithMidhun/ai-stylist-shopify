# Mech.3 verification analysis: secondary-axis bulk approve

**Source artifacts:**
- Stage 1 regression check: `.pr-3-1-7-mech-3-artifacts/05-probe-stage-1-post-mech-3.json`, captured 2026-05-10T17:55Z
- Per-axis catalog coverage: `.pr-3-1-7-mech-3-artifacts/05-axis-coverage-post-mech-3.txt`, captured 2026-05-10T17:57Z
- Eval baseline: `.pr-3-1-7-mech-3-artifacts/06-eval-post-mech-3.txt` (EvalRun `cmp03wlih0000q7x49weys2bu`)

**mech.3 commit:** `7aa2ea2` (resumed two-wave landing post mech.3a `ef9a61f`)

---

## Stage 1 regression (Step 1)

| Metric | mech.2.5 baseline | post-mech.3 | Drift |
|--------|------------------:|------------:|------:|
| Stage 1 input universe (`stage1InputAfterMech1`) | 1,169 | 1,169 | 0 |
| Products with available variant | 29 | 29 | 0 |
| Distinct products with any APPROVED tag | 52 | 52 | 0 |

Per-fixture Stage 1 candidate counts identical to mech.1.5/mech.2.5 (full grid in `05-probe-stage-1-post-mech-3.json`):

| Fixture | mech.2.5 | post-mech.3 |
|---------|---------:|------------:|
| fashion-casual-office-shirts | 26 | 26 |
| fashion-festive-kurta-women | 0 | 0 |
| fashion-going-out-outfit | 1000 | 1000 |
| fashion-linen-shirts-white | 26 | 26 |
| fashion-minimalist-daily-wear | 1000 | 1000 |
| fashion-oos-stress-1 | 26 | 26 |
| fashion-oos-stress-2 | 0 | 0 |
| fashion-oversized-fit-kurta | 2 | 2 |
| fashion-show-jackets | 5 | 5 |
| fashion-show-trousers | 8 | 8 |
| fashion-summer-shorts-size-m | 0 | 0 |
| fashion-wedding-reception | 1000 | 1000 |

mech.3 did not touch Stage 1's hard-filter shape. Drift of 0 confirms.

---

## Per-axis catalog coverage (Step 2)

| Axis | APPROVED | PENDING_REVIEW | REJECTED | Distinct products with APPROVED |
|------|---------:|---------------:|---------:|--------------------------------:|
| gender | 50 | 1 | 0 | 50 |
| category | 50 | 1 | 0 | 50 |
| occasion | 66 | 14 | 0 | 49 |
| color_family | 48 | 4 | 0 | 47 |
| material | 51 | 0 | 0 | 51 |
| fit | 39 | 12 | 0 | 39 |
| season | 48 | 11 | 0 | 47 |
| size_range | 15 | 44 | 0 | **3** |
| style_type | 45 | 7 | 0 | 44 |
| **Secondary total** | **312** | **92** | **0** | — |

Pre-mech.3 baseline for the 7 secondary axes: 0 APPROVED catalog-wide on every axis (per planning artifact 16). Post-mech.3 secondary-axis total of 312 matches the bulk-approve flips per `04-post-pass-axis-coverage.txt` exactly.

**Important diagnostic — `size_range` distinct-product coverage = 3.** 15 APPROVED tag rows but only 3 distinct products carry them. Most size_range tags are clustered on a small handful of products with multiple size values per product (e.g., one product with size_range=xs,s,m,l,xl APPROVED = 5 tag rows, 1 distinct product). This isn't a bulk-approve issue — it reflects how the AI tagger writes size_range tags (one row per available size, not one row per product). Bears on op debt #46's size_range reliability note: even the 25% of size_range tags that cleared the 0.8 confidence threshold cluster on very few products.

The other 6 secondary axes show distinct-product coverage close to or matching their APPROVED row counts (occasion 49≈66, color_family 47≈48, material 51=51, fit 39=39, season 47≈48, style_type 44≈45) — these are largely 1-tag-per-product axes.

---

## Eval baseline (Step 3)

| Metric | mech.1.5 baseline | mech.2.5 baseline | post-mech.3 | Drift from mech.2.5 |
|--------|------------------:|------------------:|------------:|--------------------:|
| EvalRun ID | `cmozgj11v0000q73shz5w7t5g` | `cmozis3lg0000q7ukskdstwt1` | `cmp03wlih0000q7x49weys2bu` | (new run) |
| pipelineVersion | 3.1.0 | 3.1.0 | 3.1.0 | (unchanged) |
| totalQueries | 12 | 12 | 12 | 0 |
| pass / partial / fail | 2 / 0 / 10 | 2 / 0 / 10 | **3 / 1 / 8** | +1 PASS, +1 PARTIAL, −2 FAIL |
| **aggregateScore** | **0.1667** | **0.1667** | **0.3333** | **+0.1666 (2× lift)** |

The aggregateScore lift lands within the predicted 0.30-0.50 range. **First non-degenerate baseline movement of the 5-mech chain.** Drift attributable specifically to high-confidence secondary-axis tag matches (mech.3a's 0.8 threshold filter ensures no false-positive contributions from sub-0.8 tags).

---

## Per-fixture trajectory

| Fixture | mech.1.5 status | post-mech.3 status | Score | What changed |
|---------|-----------------|--------------------|------:|--------------|
| fashion-casual-office-shirts | FAIL | **PASS** | 1.0000 (relaxed=1.00) | category=shirt + occasion + style_type all APPROVED catalog-wide; 6/6 cards satisfy |
| fashion-festive-kurta-women | FAIL | FAIL | 0.0000 | gender=female still 0% APPROVED — op debt #43; Stage 1 still returns 0 candidates |
| fashion-going-out-outfit | FAIL | FAIL | 0.0000 | 1000-candidate universe, but Stage 5 diversity-selected top-6 don't carry APPROVED occasion ∩ style_type tags from the fixture's allowed values; relaxed=0 |
| fashion-linen-shirts-white | FAIL | FAIL | 0.1667 (relaxed=0.17) | **1/6 cards satisfies category=shirt + color_family=white/beige + material=linen** — partial credit visible |
| fashion-minimalist-daily-wear | FAIL | FAIL | 0.1667 (relaxed=0.17) | 1/6 cards satisfies style_type=minimal/classic/relaxed + occasion=casual/work |
| fashion-oos-stress-1 | FAIL | FAIL | 0.1667 (relaxed=0.17) | 1/6 cards satisfies the same shirt + white/beige + linen pattern |
| fashion-oos-stress-2 | FAIL | FAIL | 0.0000 | category=saree still 0 catalog-APPROVED — mech.4 conditional target |
| fashion-oversized-fit-kurta | FAIL | **PARTIAL** | 0.5000 (relaxed=0.50) | Stage 1 returns 2 candidates; **1/2 satisfies category=kurta + fit=oversized/relaxed** |
| fashion-show-jackets | PASS | PASS | 1.0000 | (already PASS at mech.1.5 — single-axis category=jacket fixture) |
| fashion-show-trousers | PASS | PASS | 1.0000 | (already PASS at mech.1.5 — single-axis category=pants fixture) |
| fashion-summer-shorts-size-m | FAIL | FAIL | 0.0000 | category=shorts still 0 catalog-APPROVED — mech.4 conditional target |
| fashion-wedding-reception | FAIL | FAIL | 0.0000 | 1000-candidate universe, top-6 don't carry APPROVED occasion=festive/event/formal; relaxed=0 |

---

## Findings

### mech.3 eval lift attribution

aggregateScore moved 0.1667 → 0.3333 (+0.1666, exactly 2/12 fixture-equivalents). Lift composition:
- **+1 full PASS** (`fashion-casual-office-shirts`, +1.0/12 = +0.0833)
- **+1 PARTIAL at 0.50** (`fashion-oversized-fit-kurta`, +0.50/12 = +0.0417)
- **+3 fixtures gaining partial-credit relaxed=0.17** (`linen-shirts-white`, `minimalist-daily-wear`, `oos-stress-1`, each +0.1667/12 = +0.0139 × 3 = +0.0417)

Sum: 0.0833 + 0.0417 + 0.0417 = 0.1667 ✓ (matches drift exactly).

### Diagnostic-clarity confirmation (mech.3a's threshold value)

The score lift is attributable specifically to high-confidence (≥0.8) secondary-axis tag matches. The +0.0417 partial-credit signals across 3 fixtures (each landing exactly at relaxed=0.17 = 1/6 satisfaction) demonstrates the value of mech.3a's 0.8 threshold: the matches are real per-card matches on real APPROVED tag values, not noise from low-confidence approximations. A lower threshold would have inflated relaxed-match scores artificially without signaling actual catalog-tag quality.

### Why two no-hard-filter fixtures still score 0

`fashion-going-out-outfit` and `fashion-wedding-reception` get Stage 1 universes of 1000 (no per-axis hard filter), but their post-Stage-5 top-6 don't carry APPROVED tags matching the fixture's `occasion` filter values. Two compounding factors:
- Stage 5's diversity quotas (CATEGORY_MAX=2, COLOR_FAMILY_MAX=3) select top-K based on diversity, not tag-match-likelihood.
- Of the 49 distinct products with APPROVED occasion tags, few may rank highly enough on Stage 2's semantic similarity to survive Stage 5 selection.

Not a mech.3 problem — it's a Stage 2/Stage 5 ranking / quota interaction. Documented but not actioned.

### mech.4 conditional gate — settled NOT cuttable

mech.1.5's prediction holds: `oos-stress-2` (saree) and `summer-shorts-size-m` (shorts) remain EMPTY post-mech.3 (Stage 1 returns 0 candidates because category=saree and category=shorts have 0 catalog-APPROVED rows). mech.4 vocabulary expansion is required to address them. Plus `festive-kurta-women` (gender=female, op debt #43) which mech.4's category-axis vocabulary expansion won't address.

### mech.5 re-anchor data point

Post-mech.3 aggregateScore of 0.3333 is the load-bearing baseline mech.5 retires R3=0.0833 against. The "non-degenerate baseline" promise of the 5-mech chain is now empirically realized — the eval is no longer mathematically degenerate (single-PASS-1.0/12 = 0.0833); it now reflects substantive per-fixture per-axis match measurement. The R3.0/R3.1/R3.2 ladder mech.5 will lock can anchor at 0.3333 (or whatever post-mech.4 lifts it to) with diagnostic meaning.

---

## Outstanding 3.1.7 work

- **mech.4 (conditional, NOT cuttable):** vocabulary expansion for `category=saree` and `category=shorts`. Address the two remaining EMPTY-via-vocabulary-gap fixtures.
- **mech.5:** retire R3, re-anchor eval baseline against the post-mech.4 cumulative state, sub-bundle close.
