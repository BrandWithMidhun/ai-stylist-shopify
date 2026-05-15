# Artifact 03 — Per-fixture delta verification (mech.1 denominator switch)

**Mech:** 3.1.8-mech.1 (`relaxedMatchAtK` denominator switch from `Math.max(1, top.length)` to `Math.max(1, k)`)
**Change site:** `app/lib/recommendations/v2/eval/scoring.ts:91`
**Pre-switch EvalRun:** `cmp76k9sg0000q728j0esgabb` (artifact 01)
**Post-switch EvalRun:** captured this commit (artifact 02)

## Pre-flight assumption verification

Thread 2 artifact 28 assumed K=6 uniformly across all 12 fixtures. Step 0.c re-confirmation: all 12 fixture JSON files in `app/lib/recommendations/v2/eval/fixtures/` carry `"k": 6`. K source is `fixture.k ?? 6` at `runner.server.ts:82`. Prediction math holds.

## Per-fixture results

| Fixture | Pre-switch | Post-switch | Delta | Status |
|---|---:|---:|---:|---|
| fashion-casual-office-shirts | 1.0000 | 1.0000 | 0 | PASS → PASS |
| fashion-festive-kurta-women | 0.0000 | 0.0000 | 0 | FAIL → FAIL |
| fashion-going-out-outfit | 0.0000 | 0.0000 | 0 | FAIL → FAIL |
| fashion-linen-shirts-white | 0.1667 | 0.1667 | 0 | FAIL → FAIL |
| fashion-minimalist-daily-wear | 0.1667 | 0.1667 | 0 | FAIL → FAIL |
| fashion-oos-stress-1 | 0.1667 | 0.1667 | 0 | FAIL → FAIL |
| fashion-oos-stress-2 | 0.0000 | 0.0000 | 0 | FAIL → FAIL |
| fashion-oversized-fit-kurta | 0.0000 | 0.0000 | 0 | FAIL → FAIL |
| **fashion-show-jackets** | **1.0000** | **0.8333** | **-0.1667** | **PASS → PASS** |
| fashion-show-trousers | 1.0000 | 1.0000 | 0 | PASS → PASS |
| fashion-summer-shorts-size-m | 0.0000 | 0.0000 | 0 | FAIL → FAIL |
| fashion-wedding-reception | 0.0000 | 0.0000 | 0 | FAIL → FAIL |
| **Aggregate** | **0.2917** | **0.2778** | **-0.0139** | **3/0/9 → 3/0/9** |

## Verification verdict

**Prediction matched exactly.** Thread 2 artifact 28 § 2 predicted:
- aggregateScore: 0.2917 → 0.2778 (delta −0.0139). ✓ Confirmed.
- Only `fashion-show-jackets` affected. ✓ Confirmed.
- `fashion-show-jackets`: 1.000 → 0.833. ✓ Confirmed.
- `fashion-show-jackets` remains PASS (0.833 ≥ PASS_THRESHOLD=0.75). ✓ Confirmed.
- pass/partial/fail count unchanged (3/0/9 → 3/0/9). ✓ Confirmed.

## Why only fashion-show-jackets shifts

The denominator change `Math.max(1, top.length)` → `Math.max(1, k)` only produces a different result when `top.length < k`. Of the 12 fixtures:
- 3 fixtures return 6 candidates with all satisfying (`casual-office-shirts`, `show-trousers`): top.length == k == 6. Denominator unchanged.
- 5 fixtures return 0 candidates (EMPTY_STAGE_1 or upstream-empty): numerator 0 → score 0 either way.
- 3 fixtures return 6 candidates with 1 satisfying (`linen-shirts-white`, `minimalist-daily-wear`, `oos-stress-1`): top.length == k == 6. Denominator unchanged. 1/6 in both readings.
- 1 fixture returns 5 candidates (`show-jackets`): top.length = 5 < k = 6. Denominator changes from 5 to 6. Score 5/5 = 1.000 → 5/6 = 0.833.

`fashion-show-jackets` is the only fixture in the suite that exercises the `top.length < k` regime under the current catalog state. The shift confirms the K-based normalization is the load-bearing change for that specific fixture.

## Implication for mech.2 (the flip)

mech.2's verification (mech.2.5) runs against R3.1 ≥ 0.2778 (no regression) — NOT against the pre-mech.1 0.2917 anchor. The flip ships against the corrected measurement contract.

The flip itself is not expected to produce eval movement (v2 is already the eval-pipeline-of-record). If post-flip eval moves from 0.2778, the deviation is the finding worth surfacing at mech.2.5.

## R3 ladder (locked at planning-round close, confirmed empirically here)

- **R3.0** = 0.2778 (post-mech.1, K-based normalization). ✓ Confirmed by this eval.
- **R3.1** = ≥ 0.2778 (3.1.8 flip target; no regression).
- **R3.2** = ≥ 0.50 (Phase 5 multi-mode; policy-level).

R3.0 = 0.2778 is now the load-bearing anchor for all 3.1.8 verification. Pre-3.1.8 R3 values (0.0833, 0.1667, 0.3333, 0.2917) are non-comparable due to the denominator semantics change and are retired per HANDOFF #54.
