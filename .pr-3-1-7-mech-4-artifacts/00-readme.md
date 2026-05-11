# .pr-3-1-7-mech-4-artifacts — mech.4 evidentiary artifacts

This directory captures the artifacts of 3.1.7 mech.4 (vocabulary/rule
expansion for `category=shorts`; saree skipped — see file table).

## What mech.4 did

Pre-flight inspection (`_inspect-saree-shorts.ts`,
`_inspect-category-sources.ts`) surfaced two facts:

1. **Dev shop has zero saree-ish products** (0 results across title /
   productType matches for `saree`/`sari`). Vocabulary expansion for
   `category=saree` has no work to perform; neither AI-tagger nor
   rule-engine can produce `category=saree` ProductTag rows when no
   products match. `fashion-oos-stress-2` stays FAIL on this catalog.
2. **Dev shop has ≥20 shorts-ish products** (inspection capped at 20;
   true count surfaced as 253 at apply-rules dry-run time). All carried
   `productType="Men's Shorts"` or co-ord-set products with "shorts" in
   title. **Zero existing `category=shorts` ProductTag rows.**

Plus broader context: pre-mech.4 the dev shop had **51 category tag
rows total** (50 APPROVED + 1 PENDING_REVIEW, all source=AI) across
1,168 ACTIVE products — only ~4.3% catalog coverage on the category
axis specifically. Op debt #49 captures this gap.

mech.4 shipped:
- New rule `"Shorts category"` in `rule-seeds.ts` SEED_RULES.FASHION
  (canonical for future FASHION shops).
- One-off DB insert into the dev shop's TaggingRule table (`seedRules()`
  is shop-level-idempotent and bails on shops with any existing rules;
  dev shop had 7 from earlier onboarding).
- New `scripts/apply-rules-to-shop.ts` (the third item in the "shop
  onboarding kit" alongside `bulk-approve-tags.ts` and
  `bulk-reembed-products.ts`).
- Live apply-rules pass on the `category` axis only — narrow scoping
  isolates mech.4's contribution from the existing material/gender
  rules. **253 RULE-source APPROVED `category=shorts` rows written**,
  audit trail via `actorId='system://3.1.7-mech.4-apply-rules'`.

Post-mech.4 category coverage: 303 APPROVED (50 AI + 253 RULE), 303
distinct products with APPROVED category. mech.4's 1:1 product-touched/
tags-written ratio (253 == 253) holds because category is a single-value
axis and each match writes one tag.

## Files

| File | Captured during | What it shows |
|------|-----------------|---------------|
| 00-readme.md | mech.4 (this commit) | (this file) |
| _inspect-saree-shorts.ts | mech.4 pre-flight | one-shot evidence script |
| _inspect-saree-shorts-output.txt | mech.4 pre-flight | 0 saree-ish, ≥20 shorts-ish, 0 existing rows |
| _inspect-category-sources.ts | mech.4 pre-flight | one-shot evidence script |
| _inspect-category-sources-output.txt | mech.4 pre-flight | 51 category rows total, all AI-source |
| _seed-shorts-rule.ts | mech.4 (Step 3) | one-shot DB insert script for the dev shop |
| 00-seed-shorts-rule.txt | mech.4 (Step 3) | seed insert output (rule id + priority) |
| 01-apply-rules-dry-run.txt | mech.4 (Step 4) | dry-run: 253 products would be touched |
| 02-apply-rules-live.txt | mech.4 (Step 5) | live pass: 253 RULE-source APPROVED rows written (200 kurta + 53 shorts — see mech.4.5 framing correction) |
| 03-axis-coverage-post-mech-4.txt | mech.4 (Step 6) | per-axis APPROVED counts post-pass — category 50→303 |
| 04-probe-stage-1-post-mech-4.json | mech.4.5 | Stage 1 regression probe; kurta fixture shift (2→202) surfaced here |
| 05-axis-coverage-post-mech-4.txt | mech.4.5 | per-axis APPROVED counts matching artifact 03 |
| 06-eval-post-mech-4.txt | mech.4.5 | eval CLI re-run — aggregateScore 0.3333 → 0.2917 (regression on kurta fixture) |
| 07-mech-4-verification-analysis.md | mech.4.5 | full distribution-shift analysis + framing correction + cumulative 3.1.7 attribution |
| _inspect-rule-state.ts | mech.4.5 | one-shot DB inspection script (discovered the pre-existing kurta+jeans rules) |
| _inspect-rule-state-output.txt | mech.4.5 | DB state output: 7 rules total, audit trail decomposition (200 kurta + 53 shorts) |

## Notes

**253 vs the prompt's "~20-50" prediction:** the rule's `title_contains
"shorts"` condition catches co-ord sets ("Noel T-Shirt & Shorts Co-Ord
Set", "Milo Shirt & Shorts Co-ord Set") in addition to the strict
shorts-typed products visible in the pre-flight LIMIT-20 sample. This
is consistent with the existing rule-seeds.ts pattern (`"Linen
material"` uses `title_contains "linen"` similarly broadly). Trade-off
accepted at mech-prompt time: title-contains is a legitimate
categorical signal for "this product is relevant to a shorts query,"
even when the product is a co-ord set that includes shorts.

**MECH.4.5 FRAMING CORRECTION:** mech.4's commit message and HANDOFF
entry described the live-pass result as "253 RULE-source APPROVED
`category=shorts` rows." That's wrong. The actual decomposition (per
the mech.4.5 DB inspection, `_inspect-rule-state-output.txt`) is:
**200 RULE-source `category=kurta`** (a pre-existing `Kurta →
category=kurta` rule fired retroactively when apply-rules-to-shop.ts
swept the catalog) **+ 53 RULE-source `category=shorts`** (the new
rule mech.4 added).

The dev shop's TaggingRule table had **6 pre-existing rules** at
mech.4 start (not 7 as mech.4's prompt context assumed), and two of
those had `category` effects (`Kurta → category=kurta` at priority
102, `Jeans → category=jeans` at priority 103) that had never been
applied to the catalog. Mech.4's `--axes=category` invocation fired
both alongside the new shorts rule. See artifact 07's full analysis
and op debt #51.

**Saree skipped, evidence:** `_inspect-saree-shorts-output.txt`
returned 0 saree-ish products. The existing `saree` entry in
`AXIS_OPTIONS.FASHION.category.values` is ready for future merchants
with saree merchandise; no work needed on this catalog. Logged as op
debt #48.

The underscore-prefixed files (`_inspect-*.ts`, `_seed-*.ts`) are
one-shot evidentiary tools, not reusable across sub-bundles.
