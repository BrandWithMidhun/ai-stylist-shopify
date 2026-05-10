# Mech.2 verification analysis: variant-loading wire (Stage 5.5)

**Source artifacts:**
- Stage 1 regression check: `.pr-3-1-7-mech-2-artifacts/01-probe-stage-1-post-mech-2.json`, captured 2026-05-10T07:53Z
- End-to-end pipeline probe: `.pr-3-1-7-mech-2-artifacts/02-pipeline-end-to-end-post-mech-2.json`, captured 2026-05-10T07:55Z
- Eval baseline: `.pr-3-1-7-mech-2-artifacts/03-eval-post-mech-2.txt` (EvalRun `cmozis3lg0000q7ukskdstwt1`)

**mech.2 commit:** `b9a5152`

---

## Stage 1 regression (Step 1)

| Metric | Mech.1.5 baseline | Post-mech.2 | Drift |
|--------|------------------:|------------:|------:|
| Stage 1 input universe (`stage1InputAfterMech1`) | 1,169 | 1,169 | 0 |
| Products with available variant (`productsWithAvailableVariant`) | 29 | 29 | 0 |
| Distinct products with any APPROVED tag | 52 | 52 | 0 |

Per-fixture Stage 1 candidate counts (full grid identical to mech.1.5's `03-distribution-shift-analysis.md`):

| Fixture | Mech.1.5 | Post-mech.2 |
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

mech.2 retired the `bool_or` aggregate from Stage 1's SELECT but did not touch Stage 1's WHERE clause. Drift of 0 confirms the retirement was clean.

---

## End-to-end pipeline probe (Step 2)

Per-fixture variant-load behaviour:

| Fixture | Card count | variantId populated | available=true | compareAtPrice populated | Stage 5.5 ms |
|---------|-----------:|--------------------:|---------------:|-------------------------:|-------------:|
| fashion-casual-office-shirts | 6 | 6/6 | 0/6 | 5/6 | 1382 |
| fashion-festive-kurta-women | 0 | n/a | n/a | n/a | (Stage 1 short-circuit) |
| fashion-going-out-outfit | 1 | 1/1 | 0/1 | 0/1 | 913 |
| fashion-linen-shirts-white | 6 | 6/6 | 0/6 | 2/6 | 810 |
| fashion-minimalist-daily-wear | 6 | 6/6 | **1**/6 | 0/6 | 456 |
| fashion-oos-stress-1 | 6 | 6/6 | 0/6 | 0/6 | 473 |
| fashion-oos-stress-2 | 0 | n/a | n/a | n/a | (Stage 1 short-circuit) |
| fashion-oversized-fit-kurta | 2 | 2/2 | 0/2 | 0/2 | 915 |
| fashion-show-jackets | 5 | 5/5 | 0/5 | 2/5 | 923 |
| fashion-show-trousers | 6 | 6/6 | **1**/6 | 0/6 | 458 |
| fashion-summer-shorts-size-m | 0 | n/a | n/a | n/a | (Stage 1 short-circuit) |
| fashion-wedding-reception | 6 | 6/6 | 0/6 | 0/6 | 476 |

**Aggregate metrics (across the 9 non-empty fixtures, 44 total ProductCards):**

- **Cards with populated `variantId`: 44/44 (100%)** ← op debt #15 closure check
- Cards with `available=true`: 2/44 (4.5%)
- Cards with populated `compareAtPrice`: 9/44 (20%)
- Candidates that hit Stage 5.5 with no variant loaded: 0
- Stage 5.5 wall-clock — min/median/max: 456ms / 810ms / 1382ms

### Variant-data interpretation

**`variantId: 100% populated` confirms op debt #15 closes architecturally.** Every ProductCard the v2 pipeline returns now carries a numeric variantId, ready for the chat widget's `/cart/add.js` POST. Pre-mech.2 every card had `variantId: null` and the chat widget would have hidden Add-to-Cart on every recommendation.

**`available=true: 4.5%` is expected and CORRECT post-mech.2.** The catalog has only 29 products with `availableForSale=true` variants out of 1,169 ACTIVE+embedded. Stage 1's universe is 1,169; Stage 2/3/4/5 rank by similarity / merchant signals / diversity, not by availability. So OOS candidates often outrank in-stock ones in the top-K — this is the binary include/exclude design the planning doc Section 2 locked. The chat widget's binary OOS check at `chat-widget.js:839,898` will hide Add-to-Cart on the 42 OOS cards, exactly as designed. Catalog-side variant inventory hygiene (the underlying cause of 1,140 unbuyable products) remains out of 3.1.7 scope per the planning doc's out-of-scope list.

**`compareAtPrice: 20% populated` reflects real catalog discount data.** Stage 6's v1-mirror guard (`compareAtPrice > variantPrice ? compareAtPrice : null`) only surfaces a strikethrough when the comparison is meaningful.

**Stage 5.5 wall-clock surfaced as op debt candidate (see #44 below).** The 456–1382ms per-fixture range is dominated by Railway proxy network latency from the Windows dev machine, not Stage 5.5's intrinsic cost (a single `prisma.product.findMany` for ≤6 IDs should be <50ms server-side). Consistent with mech.1.5's per-fixture eval latencies (250–2814ms). Not a regression; flagged for catalog-hygiene-style follow-up.

---

## Eval baseline (Step 3)

| Metric | Mech.1.5 baseline | Post-mech.2 | Drift |
|--------|------------------:|------------:|------:|
| EvalRun ID | `cmozgj11v0000q73shz5w7t5g` | `cmozis3lg0000q7ukskdstwt1` | (new run) |
| pipelineVersion | 3.1.0 | 3.1.0 | (unchanged) |
| totalQueries | 12 | 12 | 0 |
| pass / partial / fail | 2 / 0 / 10 | 2 / 0 / 10 | 0 / 0 / 0 |
| **aggregateScore** | **0.1667** | **0.1667** | **0** |

Same two PASSes (`fashion-show-jackets`, `fashion-show-trousers`); same ten FAILs. Drift = 0 confirms mech.2's variant-loading wire is invisible to the eval harness's scoring layer (`pipeline-runner.server.ts:33-43` projects ProductCard→ProductWithTags before scoring, dropping `variantId`/`available`/`price`/`compareAtPrice`). The harness scores against handles + tags only; mech.2 didn't touch handles or tags. Predicted and confirmed.

---

## Op debt findings

### Op debt #15 — CLOSED

- **Status:** closed architecturally at mech.2 (`b9a5152`); verification completed at mech.2.5 (this commit).
- **Evidence:** 100% of returned ProductCards (44/44 across the 9 non-empty fixtures) carry populated `variantId`. Stage 5.5 (`loadAndAttachVariants` in `pipeline.server.ts`) loads the lowest-priced available variant per surviving Stage 5 candidate and threads it through Stage 6's `formatProductCard`. The chat widget's Add-to-Cart contract (`chat-widget.js:894-915` requires `/^\d+$/` numeric variantId) is satisfied by every card.

### Op debt #43 — NEW (logged, not actioned)

- `gender=female` is a third 0%-APPROVED axis on the dev shop, surfaced in mech.1.5's distribution-shift analysis as the blocker for `fashion-festive-kurta-women` (which combines `gender=female` AND `category=kurta` as Stage 1 hard filters; both must have APPROVED matches). The bulk-approve from mech.6 baseline-prep flipped 50 PENDING gender tags but apparently none of them are `female` — likely all `male` or `unisex`.
- **Out of mech.3 scope** (mech.3's `--axes=occasion,color_family,material,fit,season,size_range,style_type` invocation does not target gender).
- **Out of mech.4 scope** (mech.4 is category-axis vocabulary expansion, not gender-value approval).
- Revisit at 3.1.7 close (mech.5) or 3.1.8 planning round.

### Op debt #44 — NEW (logged, not actioned)

- Stage 5.5 wall-clock latency from Windows dev machine ranges 456–1382ms per fixture. Consistent with mech.1.5's per-fixture eval latencies (250–2814ms). Likely dominated by Railway proxy network RTT (~200-300ms per round trip) rather than intrinsic query cost — the Stage 5.5 query is a single `prisma.product.findMany` against ≤6 candidate IDs, which should be <50ms server-side.
- Production behaviour (Railway → Railway DB) is not measured by this probe; production latency is expected to be much lower.
- Worth confirming once the v2 flip ships (3.1.8) and real production tool calls produce server-side timing data via the existing `console.log("[recommend_products_v2]", { ...stages })` telemetry in `recommend-products-v2.server.ts:128-139`.
- Not a 3.1.7 mech; logged as backlog observability item.

---

## Outstanding 3.1.7 work

- **mech.3:** secondary-axis bulk approve (occasion, color_family, material, fit, season, size_range, style_type). Will lift `relaxedMatchAtK` on most of the 10 FAIL fixtures.
- **mech.4 (conditional):** vocabulary expansion for `category=saree` and `category=shorts`. Per mech.1.5 evidence (still 0 catalog APPROVED post-mech.1), this mech is NOT cuttable.
- **mech.5:** retire R3 = 0.0833, re-anchor eval baseline against post-mech.1-3(-4) cumulative state, HANDOFF amendment.

`fashion-festive-kurta-women` will remain FAIL through mech.5 because op debt #43 (`gender=female` 0% APPROVED) is out of mech.3 / mech.4 scope. Documented at sub-bundle close.
