# Mech.4 verification analysis: category=shorts rule-engine pass (and the kurta-rule surprise)

**Source artifacts:**
- Stage 1 regression check: `.pr-3-1-7-mech-4-artifacts/04-probe-stage-1-post-mech-4.json`, captured 2026-05-11T20:51Z
- Per-axis catalog coverage: `.pr-3-1-7-mech-4-artifacts/05-axis-coverage-post-mech-4.txt`, captured 2026-05-11T20:53Z
- Eval baseline: `.pr-3-1-7-mech-4-artifacts/06-eval-post-mech-4.txt` (EvalRun `cmp1dlvil0000q7gg3scb6rt7`)
- DB state inspection: `.pr-3-1-7-mech-4-artifacts/_inspect-rule-state-output.txt`

**mech.4 commit:** `688019d`

---

## Framing correction (load-bearing premise check)

mech.4's commit message + HANDOFF entry framed the result as "253 RULE-source APPROVED `category=shorts` rows written." That's not what actually happened.

The dev shop's TaggingRule table had **6 pre-existing rules** at mech.4 start (NOT 7 as mech.4's prompt context assumed). Critically, two of those pre-existing rules had `category` effects that had never been applied to the catalog:

| Priority | Name | Effect | Status pre-mech.4 |
|---------:|------|--------|-------------------|
| 100 | Men's in title → gender=male | gender | (gender axis, unaffected by mech.4's --axes=category) |
| 101 | Women's in title → gender=female | gender | (unaffected) |
| **102** | **Kurta → category=kurta** | **category=kurta** | **never applied to catalog** |
| **103** | **Jeans → category=jeans** | **category=jeans** | **never applied to catalog** |
| 104 | Linen mention → sub_category=linen | sub_category | (unaffected) |
| 105 | Cotton mention → sub_category=cotton | sub_category | (unaffected) |

Mech.4 added the 7th rule (`Shorts category` at priority 106). Mech.4's `apply-rules-to-shop.ts --axes=category` invocation then fired ALL category-effect rules across the catalog, retroactively applying both the pre-existing kurta rule AND the new shorts rule.

**Actual mech.4 write decomposition** (per `_inspect-rule-state-output.txt` audit trail with `actorId='system://3.1.7-mech.4-apply-rules'`):

| value | source | count |
|-------|--------|------:|
| kurta | RULE | **200** |
| shorts | RULE | **53** |
| **Total RULE writes** | | **253** |

The 253-row count in mech.4's commit message is correct. The "all shorts" framing is not. mech.4's actual effect: retroactive activation of the pre-existing kurta rule (200 products) PLUS the new shorts rule (53 products).

See op debt #51 for the broader discovery that the dev shop's TaggingRule table contains rules that aren't in `SEED_RULES.FASHION`.

---

## Stage 1 regression (Step 1)

| Metric | mech.3.5 baseline | post-mech.4 | Drift |
|--------|------------------:|------------:|------:|
| Stage 1 input universe (`stage1InputAfterMech1`) | 1,169 | 1,169 | 0 |
| Products with available variant | 29 | 29 | 0 |
| Distinct products with any APPROVED tag | 52 | **305** | **+253** |

Per-fixture Stage 1 candidate counts — **two fixtures shifted, not one**:

| Fixture | mech.3.5 | post-mech.4 | Δ | Cause |
|---------|---------:|------------:|---:|-------|
| fashion-casual-office-shirts | 26 | 26 | 0 | unaffected |
| fashion-festive-kurta-women | 0 | 0 | 0 | unaffected (op debt #43) |
| fashion-going-out-outfit | 1000 | 1000 | 0 | unaffected |
| fashion-linen-shirts-white | 26 | 26 | 0 | unaffected |
| fashion-minimalist-daily-wear | 1000 | 1000 | 0 | unaffected |
| fashion-oos-stress-1 | 26 | 26 | 0 | unaffected |
| fashion-oos-stress-2 | 0 | 0 | 0 | unaffected (op debt #48) |
| **fashion-oversized-fit-kurta** | **2** | **202** | **+200** | **pre-existing Kurta rule retroactively fired** |
| fashion-show-jackets | 5 | 5 | 0 | unaffected |
| fashion-show-trousers | 8 | 8 | 0 | unaffected |
| **fashion-summer-shorts-size-m** | **0** | **53** | **+53** | **new Shorts rule (mech.4)** |
| fashion-wedding-reception | 1000 | 1000 | 0 | unaffected |

The mech.4.5 prompt predicted only `fashion-summer-shorts-size-m` would shift. `fashion-oversized-fit-kurta` shifted unexpectedly — the verification gate flagged this and was surfaced before proceeding (see "Framing correction" above).

---

## Per-axis catalog coverage (Step 2)

| Axis | APPROVED (mech.3.5) | APPROVED (post-mech.4) | Drift | Distinct products with APPROVED |
|------|--------------------:|-----------------------:|------:|--------------------------------:|
| gender | 50 | 50 | 0 | 50 |
| category | 50 | **303** | **+253** | 303 |
| occasion | 66 | 66 | 0 | 49 |
| color_family | 48 | 48 | 0 | 47 |
| material | 51 | 51 | 0 | 51 |
| fit | 39 | 39 | 0 | 39 |
| season | 48 | 48 | 0 | 47 |
| size_range | 15 | 15 | 0 | 3 |
| style_type | 45 | 45 | 0 | 44 |

mech.4 was scoped to `category` only. Non-category axes drift = 0 confirms scope discipline at the script level. The unintended kurta-rule activation was scoped to category as well (the rule's effect is `category=kurta`), so the discipline wasn't violated — but the framing of "mech.4 = shorts coverage" was.

Category APPROVED breakdown by value (per `_inspect-rule-state-output.txt`):

| value | source=AI | source=RULE | Total APPROVED |
|-------|----------:|------------:|---------------:|
| innerwear | 5 | 0 | 5 |
| jacket | 5 | 0 | 5 |
| kurta | 2 | **200** | 202 |
| pants | 8 | 0 | 8 |
| shirt | 26 | 0 | 26 |
| shorts | 0 | **53** | 53 |
| t_shirt | 4 | 0 | 4 |
| **Total** | **50** | **253** | **303** |

---

## Eval baseline (Step 3)

| Metric | mech.3.5 | post-mech.4 | Drift |
|--------|---------:|------------:|------:|
| EvalRun ID | `cmp03wlih0000q7x49weys2bu` | `cmp1dlvil0000q7gg3scb6rt7` | (new run) |
| pipelineVersion | 3.1.0 | 3.1.0 | (unchanged) |
| pass / partial / fail | 3 / 1 / 8 | **3 / 0 / 9** | **0 / −1 / +1** |
| **aggregateScore** | **0.3333** | **0.2917** | **−0.0417 (REGRESSION)** |

This is the **final 3.1.7 baseline.** mech.5 retires R3=0.0833 against this 0.2917 anchor.

---

## Per-fixture trajectory

| Fixture | mech.3.5 | post-mech.4 | Δ | What changed |
|---------|----------|-------------|---|--------------|
| fashion-casual-office-shirts | PASS (1.0) | PASS (1.0) | 0 | unaffected |
| fashion-festive-kurta-women | FAIL (0) | FAIL (0) | 0 | op debt #43 (gender=female 0% APPROVED) |
| fashion-going-out-outfit | FAIL (0) | FAIL (0) | 0 | unaffected; no shorts/kurta in top-6 |
| fashion-linen-shirts-white | PARTIAL (0.17) | PARTIAL (0.17) | 0 | unaffected; shirt fixture |
| fashion-minimalist-daily-wear | PARTIAL (0.17) | PARTIAL (0.17) | 0 | unaffected |
| fashion-oos-stress-1 | PARTIAL (0.17) | PARTIAL (0.17) | 0 | unaffected |
| fashion-oos-stress-2 | FAIL (0) | FAIL (0) | 0 | op debt #48 (saree, no merchandise) |
| **fashion-oversized-fit-kurta** | **PARTIAL (0.50)** | **FAIL (0)** | **−0.50** | **REGRESSED — kurta-rule dilution; see below** |
| fashion-show-jackets | PASS (1.0) | PASS (1.0) | 0 | unaffected |
| fashion-show-trousers | PASS (1.0) | PASS (1.0) | 0 | unaffected |
| fashion-summer-shorts-size-m | FAIL (0) | FAIL (0) | 0 | Stage 1 now returns 53; top-6 lacks size_range coverage (op debt #46) |
| fashion-wedding-reception | FAIL (0) | FAIL (0) | 0 | unaffected |

---

## Findings

### The kurta-fixture regression (the main finding)

`fashion-oversized-fit-kurta` requires `category=kurta` AND `fit=oversized/relaxed` for relaxedMatchAtK to register a satisfied card.

Pre-mech.4:
- Stage 1 returned **2 candidates** (the 2 AI-tagged category=kurta products).
- Of those 2, exactly **1 had `fit` APPROVED**, producing relaxedMatchAtK = 1/2 = 0.50.

Post-mech.4:
- Stage 1 returns **202 candidates** (the 2 AI products + 200 new RULE products from the retroactive kurta rule).
- Stage 2 semantic retrieval narrows to candidatePool (50).
- Stage 3-5 rerank, apply merchant signals, apply diversity quotas → top-6.
- Of the 202 candidates, only **2** carry an APPROVED `fit` tag (the original AI-tagged products). Catalog-wide fit coverage is 39 distinct products, but only the 2 original kurta+fit-tagged products survive both filters.
- Stage 2's semantic similarity ranking + Stage 5's diversity quotas now select top-6 from a 200x-larger candidate pool. The 2 fit-tagged candidates don't survive — they're outranked by other kurta products that have higher similarity to the fixture's "oversized fit kurta" intent (irrelevant to the intent's match-quality on fit specifically, but relevant to similarity).
- Top-6 contains 6 kurta products, **0 of which have `fit` APPROVED** → relaxedMatchAtK = 0/6 = 0.

**The finding: broader category coverage HURT eval scores when secondary-axis (fit) coverage didn't scale proportionally.** This is load-bearing evidence for op debts #45 (real-merchant-pathology question), #46 (size_range AI-tagger reliability gap), #49 (broader category-coverage gap).

### The shorts-fixture non-movement

`fashion-summer-shorts-size-m` requires `category=shorts` AND `season=summer/all_season` AND `size_range=m` for relaxedMatchAtK.

Pre-mech.4: Stage 1 = 0 (no APPROVED shorts), trivially FAIL=0.

Post-mech.4: Stage 1 = 53 (mech.4's new shorts rule wrote 53 rows). But:
- size_range catalog coverage is **3 distinct products** (per mech.3.5's per-axis distinct count) — and size_range tags are clustered on 3 specific products with multiple size values each (per op debt #46).
- The overlap between (the 53 newly-shorts-tagged products) AND (the 3 size_range-tagged products) is likely small or zero.
- Stage 2/3/5 narrow to top-6; no top-6 card carries both category=shorts AND size_range=m → relaxedMatchAtK = 0/6 = 0.

The shorts fixture was unaddressable by category-axis work alone. mech.4 unblocked Stage 1 for shorts queries, but the size_range bottleneck (op debt #46) is the binding constraint at scoring time.

### Cumulative 3.1.7 chain attribution

| Mech | Eval before | Eval after | Δ | Note |
|------|------------:|-----------:|---:|------|
| pre-3.1.7 | — | 0.0833 | — | Tautological baseline (1 PASS at 1.0/12) |
| mech.1 (universe expansion) | 0.0833 | 0.1667 | +0.0833 | jackets fixture unblocked |
| mech.2 (variant-loading wire) | 0.1667 | 0.1667 | 0 | eval-invisible (variant data dropped before scoring) |
| mech.3 (secondary-axis bulk approve) | 0.1667 | 0.3333 | +0.1666 | 1 PASS (casual-office-shirts), 1 PARTIAL (oversized-fit-kurta), 3 partial-credit |
| mech.4 (rule-engine retroactive pass) | 0.3333 | 0.2917 | **−0.0417** | kurta fixture regressed PARTIAL → FAIL due to top-6 dilution |
| **Cumulative** | **0.0833** | **0.2917** | **+0.2084** | **3.5× lift over 4 mechs (one final-mech regression)** |

3.1.7's eval is now non-degenerate, reflecting substantive per-fixture per-axis match measurement, even with the mech.4 regression. The regression IS a useful finding: it surfaces a structural eval property that simple "more coverage = better eval" intuitions miss. Top-6 ranking + Stage 5 diversity quotas can drop the highest-relaxed-match candidates when the candidate pool grows without proportional secondary-axis coverage.

### Multi-tenant scoping qualification (op debt #50)

3.1.7's chain was developed, calibrated, and verified entirely against the FASHION-mode dev shop. The pre-existing kurta-rule discovery in this mech is itself a data point: even within a single store mode, real shops carry hand-customized rule configurations that diverge from `SEED_RULES`. Non-fashion merchants will diverge further. See op debt #50.

---

## Outstanding 3.1.7 work

- **mech.5:** retire R3=0.0833 against the post-mech.4 anchor (0.2917), re-anchor quality ladder, sub-bundle close. The HANDOFF close summary should honestly reflect:
  - The 3.5× cumulative lift (0.0833 → 0.2917)
  - The mech.4 regression as a structural finding worth carrying into 3.1.8 planning
  - The cumulative-vs-final-mech distinction (mech.4 reduced eval but the 3-mech chain through mech.3 was the load-bearing improvement)

---

## 3.1.8 prerequisites surfaced by 3.1.7

- **#15:** variant-loading wired (closed at mech.2)
- **#42 / #45:** Stage 6 binary vs Stage 3 weighting for availability; real-merchant in-stock-ratio question
- **#43:** gender=female axis 0% APPROVED (similar rule-engine treatment to mech.4's shorts)
- **#46:** size_range AI-tagger reliability — binding constraint for shorts fixture; AI-tagger work in 3.1.8 or Phase 5
- **#49:** category-coverage gap beyond shorts (shirt/jacket/kurta/pants etc. all need similar retroactive rule passes; mech.4's surprise kurta result is partial progress)
- **#50:** multi-tenant verification (non-fashion modes) — Phase 5 territory
- **#51 (new):** dev shop has TaggingRule rows that aren't in SEED_RULES.FASHION — divergence between code-canonical and DB-actual rule sets needs reconciliation

The kurta-fixture regression isn't a 3.1.8 prerequisite per se — it's an architectural observation about Stage 5 diversity quotas + secondary-axis sparsity. A proper fix would touch Stage 3 reranking or Stage 5 quota policy, which is beyond 3.1.8's flip-the-agent scope. Carry as architectural backlog.
