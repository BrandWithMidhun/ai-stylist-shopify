# Test strategy per option

Per Thread 2's findings, the eval harness at HEAD is a degenerate
verification surface for the v2 vs v1 question:
- aggregateScore = 0.0833 across 3 prior eval runs (mech.6 baseline,
  3.1.5 post-bulk-reembed, 3.1.6 post-α backfill).
- The single PASS is a 1-candidate degenerate match.
- 0% APPROVED on every secondary axis means relaxed-match is bounded
  below 1.0 across all multi-axis fixtures regardless of pipeline
  improvements.

So "did the eval improve" is not a meaningful test for any 3.1.7
option that doesn't first fix the structural causes of the 0.0833
floor. Each option needs a different verification path.

## Per-option test strategy

### Option A — Ship flip v2-as-is

**Test path:** Production-driven (after the fact), with high regression risk.
- Eval-driven (re-run harness): expected to stay at 0.0833 ± 0.08
  (whether v2's pipeline returns the same 1 trouser candidate is not
  guaranteed; could regress). Eval will not catch the user-visible
  Add-to-Cart breakage because the eval doesn't render the widget.
- Probe-driven: ad-hoc probe that calls the v2 tool stub, parses the
  ProductCard[] output, and asserts `variantId` is non-null. Would
  catch op debt #15 breakage at probe time. Should be a precondition
  to A shipping.
- Dev-shop-driven: chat widget tests on the dev shop. Verifies
  Add-to-Cart actually fires for recommended products. The 29-universe
  reality means ~5 query patterns are testable; the rest return zero
  recommendations.
- Production-driven: behind a flag if the merchant pool can absorb
  the regression risk.

**Verifiable?** Partially — the variant-loading mech is verifiable
via probe + dev-shop. The flip's user-impact-improvement hypothesis is
NOT verifiable today because the universe gap caps the upside.

### Option B.i — Soften Stage 1 (drop hard-filter on empty result)

**Test path:** Eval-driven (predictable null result) + probe-driven (correctness).
- Eval-driven: harness will report aggregateScore unchanged at 0.0833
  per the per-fixture grid in artifact 23. Predictable.
- Probe-driven: assert that for each currently-EMPTY fixture, the new
  fallback path returns the 29-universe candidates and Stage 2/3/4/5
  all complete without error. Catches plumbing bugs in the soften
  path.
- Dev-shop-driven: not informative — the universe-bound caps user-
  visible behavior.

**Verifiable?** Yes for correctness, no for "did it help."

### Option B.ii — Move availability filter out of Stage 1

**Test path:** Multi-pronged (probe + eval + dev-shop + integration).
- Probe-driven: per-fixture probe (analogous to thread 2's
  probe-stage-1) that confirms expanded universe (29 → 1,169) reaches
  Stage 2 input correctly. Dump per-fixture top-K for visual inspection.
- Eval-driven: harness re-baseline. Expected aggregateScore range
  0.08–0.17 (only show-jackets likely to flip). The eval doesn't move
  much because secondary-axis APPROVED is still 0%; eval is not the
  primary verification.
- Stage 5 substitute path: integration test that injects an OOS
  candidate and asserts it's substituted by an available alternative
  in the top-K. New test scaffolding required.
- Dev-shop-driven: chat widget tests verifying recommendations now
  span more diverse products. Scaling up: a few canonical merchant
  query patterns ("white shirt", "casual dress for work", "evening
  outfit") run end-to-end against the dev shop and the resulting
  ProductCard[] inspected.

**Verifiable?** Yes — but needs significant new test infrastructure
that 3.1.7 would have to build alongside the implementation.

### Option C — Defer flip; fix Stage 1 universe first

**Test path:** Per-mech, ship-as-you-go (the standard project pattern).
Each mech inside the C sub-bundle has its own verification:
- Variant-filter relocation mech: probe + eval + Stage 5 substitute
  integration test.
- Variant-loading mech (closes #15): probe asserting populated
  variantId on v2 ProductCard outputs.
- Bulk-approve secondary axes mech (D folded in): pre/post tag census
  + dry-run + real run + eval re-baseline (non-degenerate eval should
  start moving above 0.0833).
- After C completes: 3.1.8 flip mech's verification is finally
  meaningful — eval baseline is non-degenerate, dev-shop chat shows
  real diverse recommendations, op debt #15 is closed in C, op debt
  #11 is closed in C.

**Verifiable?** Yes, with the right verification at each mech. C
trades shipping a flip in 3.1.7 for shipping a flip with meaningful
verification in 3.1.8.

### Option D — Bulk-approve more axes (alone)

**Test path:** Eval-driven, predictable null result.
- Eval-driven: aggregateScore stays at 0.0833 because the 29-universe
  cap is independent of secondary-axis APPROVED coverage. The bulk-
  approve helps Layer 3 (relaxed match scoring) but Layer 1+2 (Stage
  1 universe + APPROVED-category intersection) remains the dominant
  bottleneck.
- Probe-driven: post-approve census (analogous to thread 2's probe).
  Confirms tag rows flipped PENDING_REVIEW → APPROVED. Doesn't speak
  to user-visible behavior.

**Verifiable?** Yes for the tag census; no for user impact unless
paired with B.ii or C.

### Option E — Vocabulary expansion (saree, shorts)

**Test path:** Catalog inspection + eval-driven.
- Inspection: confirm the 4 newly-APPROVED saree/shorts products are
  in (or can be moved into) the 29-universe. If they're not, E is a
  no-op for fixture pass-rate.
- Eval-driven: at most 2 fixtures (oos-stress-2, summer-shorts-size-m)
  could move from FAIL to PARTIAL/PASS. Even those need their other
  axes (occasion for saree, season+size_range for shorts) to also be
  APPROVED, which requires D pairing.

**Verifiable?** Trivially via post-approve census. User impact still
gated on B.ii or D.

## Test-strategy summary

| Option | Eval informative? | Probe informative? | Dev-shop informative? | Production-grade test possible in 3.1.7? |
|--------|-------------------|--------------------|-----------------------| -----------------------------------------|
| A | Marginally (catches regression only) | Yes (#15 breakage) | Yes (Add-to-Cart works?) | Behind a flag, with regression risk |
| B.i | No (predictable 0.0833) | Yes (correctness) | No (universe cap) | No |
| B.ii | Slightly (jacket might flip PASS) | Yes (universe expansion) | Yes (more diverse recs) | Yes, but new test scaffolding required |
| C | Per-mech, gradually | Per-mech | After C completes, yes | After C completes (3.1.8 flip), yes |
| D | No (predictable 0.0833) | Yes (tag census) | No | No |
| E | At most 2 fixtures | Yes (per-product) | At most 2 query patterns | No |

**Headline:** the only options whose test-paths are both informative
AND end in a meaningful "did this make the chat better" verification
are B.ii and C. Both require new test scaffolding 3.1.7 would build
alongside implementation.

This reinforces the artifact-24 conclusion: A and B.i ship without
meaningful verification; B.ii and C ship with verification. C is the
clean separation that lets each mech inside it have its own
verification, vs B.ii that bundles multiple mechs into one verification
event.
