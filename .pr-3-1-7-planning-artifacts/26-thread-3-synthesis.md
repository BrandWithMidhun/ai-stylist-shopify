# Thread 3 synthesis — option pick for 3.1.7

HEAD: `e48e079` (3.1.6 close). Investigation: read-only.
Inputs: artifacts 01-08 (Thread 1), 09-18 (Thread 2), 19-25 (Thread 3
support).

## 1. Restated problem

The resume prompt framed 3.1.7 as "the post-eval-pass flip commit" —
the single-line registry change that swaps the agent's
`recommend_products` tool from v1 to v2, gated on op debt #15
(variant-loading on v2 ProductCard). Threads 1 and 2 invalidated that
framing in two ways:

1. **The flip itself is small (Thread 1)** — registry edit is ~3
   logical edits / ~8 lines, single seam, single consumer. The
   variant-loading prerequisite (op debt #15) adds a small mech
   (~1 sub-mech) to the flip. So "ship the flip" is ~1.5–2 mechs.
2. **The flip is not the load-bearing question (Thread 2)** — the
   v2 pipeline is bottlenecked at Stage 1 by a structural variant
   filter that caps the universe at 29 products (out of 1,169
   ACTIVE+embedded), and at Stage 6 scoring by 0% APPROVED on every
   secondary axis. Shipping the flip without addressing either
   bottleneck means v2 ships with a degenerate eval baseline (0.0833,
   1/12 fixture pass-rate, single-product PASS) that is mathematically
   identical to v1's behavior in the dimensions users care about.

What 3.1.7 is actually deciding: **does the project want to ship a
known-degenerate flip on schedule, or does it want to defer the flip
until v2 has been moved out of its degenerate state?** The
"availability authority" design question (artifact 24) is the
precondition: every flip-shipping option implicitly answers it
differently, and only one of those answers (Stage 6 / v2 tool stub
owns availability) is architecturally correct for the long term.

## 2. Premise corrections (cumulative across all three threads)

### From Thread 1
- The "registry" referenced in op debt #15 is `app/lib/chat/tools/
  registry.server.ts`, not `app/lib/recommendations/registry.server.ts`.
  No `app/lib/recommendations/v1/` directory exists.
- Flip is one logical seam, ~3 edits in registry.server.ts.
- v1 and v2 tool stubs are signature-compatible; no consumer cascades.
- Variant-loading mech is required precondition, not optional polish.

### From Thread 2
- Stage 1 structural universe is 29/1,169 ACTIVE products (97.5% of
  catalog has no `availableForSale=true` variant). Bulk-approving
  more axes does NOT lift this cap.
- Triple eval-invariance (mech.6 baseline → 3.1.5 post-bulk-reembed →
  3.1.6 post-α) is caused by two compounding gaps: (a) Stage 1 universe
  ∩ APPROVED-category-value = 1 product, and (b) 0% APPROVED on every
  secondary axis. Re-embedding doesn't change either.
- The single PASS (`fashion-show-trousers`) is mathematically
  degenerate: 1 candidate / 1 satisfying = relaxed=1.0; 1.0 / 12 fixtures
  = 0.0833.
- R3 = 0.0833 is a no-op release gate (set TO the empirical value).
  Any non-regressing build clears it.

### From Thread 3 (new)
- **Op debt #11's resolution path is invalid.** #11 says "Phase 5
  full-catalog tagging will resolve this naturally" for the OOS-stress
  fixtures. Thread 2 shows shirt-fixture failure is universe-driven
  (26 catalog APPROVED shirts, 0 in 29-universe), not tagging-driven.
  Phase 5 tagging on the same 1,140-product unbuyable subset wouldn't
  help. (Artifact 19.)
- **Mech.5 D6's "Stage 1's EXISTS pre-filter handles steady state"
  premise was wrong from the start.** What was thought to be the rare
  mid-pipeline-flip case is actually the steady-state case for this
  catalog. The OOS-substitute architecture isn't an edge-case feature;
  it's a structural requirement. (Artifact 22.)
- **No standalone decision register exists.** D-numbered locked
  decisions are scoped per-mech in source-file headers. Numbering
  restarts per mech. Citations must include both mech AND file path
  to disambiguate. Documentation gap surfaced as op debt candidate
  for 3.1.7 close. (Artifact 21.)

## 3. Recommended pick

**OPTION C — defer flip; ship Stage 1 universe + secondary-axis
APPROVED fixes in 3.1.7; flip in 3.1.8.**

Specifically: 3.1.7 = "Stage 1 universe correction + variant-loading
authority resolution + secondary-axis APPROVED bulk" (B.ii + #15
variant-loading + D folded together). Flip mech itself moves to
3.1.8 once eval baseline is non-degenerate.

### Why C, not A

A ships v2 with op debt #15 unresolved → broken Add-to-Cart on every
recommendation. Even if the variant-loading mech ships first, A still
ships v2 against the wrong availability-authority answer (artifact 24
recommends Answer 2; A implicitly assumes Answer 1) and with a 29-
product universe that means user-visible recommendation quality drops
from "v1 retrieves from 1,169 embedded products" to "v2 retrieves from
29 buyable-by-Stage-1-EXISTS products with the same eval score."

### Why C, not B.i

B.i is a tactical patch (soften Stage 1 hard-filter on empty result)
that doesn't fix the dominant bottleneck (the variant filter, not the
hard-filter). The per-fixture eval prediction (artifact 23) shows
aggregateScore unchanged at 0.0833. B.i adds a "soft when empty" code
path that's silently degenerate — confuses the Stage 1 contract and
adds future debt without any user-visible upside.

### Why C, not B.ii (in 3.1.7)

B.ii is the right *work* but not the right *bundle*. B.ii couples
the variant-filter relocation, Stage 5 OOS-substitute, Stage 6
variant-load, and v2 tool stub variant-load into one mech surface.
That's the right architectural move (artifact 24 recommends Answer 2,
which B.ii implements), but it's a planning-round-of-its-own that
also happens to share commit-space with the flip. Bundling them
together creates a tight coupling that raises bug surface AND ties
the flip to a successful big-mech outcome.

C separates these: 3.1.7 ships the universe-correction sub-bundle
(which is B.ii's body of work, with explicit per-mech boundaries).
3.1.8 ships the flip mech against a non-degenerate eval baseline, with
op debts #15 and #11 already closed. Each sub-bundle has clean
verification: 3.1.7 verifies "v2 pipeline produces meaningful
candidate sets"; 3.1.8 verifies "v2 outperforms v1 in production".

### Why C, not D alone

D alone leaves the universe at 29 products. Eval stays at 0.0833.
Approving more PENDING tags without merchant review is also an
unwanted reuse of the bulk-approve concession from mech.6 baseline-prep
(which was a one-shot pre-launch concession, not a pattern). D folded
into C is fine; D as a standalone 3.1.7 is wrong.

### Why C, not E alone

E alone fixes 2 fixtures' vocabulary gap. Same logic as D — only
helpful as part of C. Folding E into C catches the saree + shorts
fixtures along with the broader bulk-approve work.

### The discipline question

The resume prompt's discipline reminder asked: "Picking the easier-to-
ship option to keep momentum is the kind of fork the project has
consistently chosen against." This bears directly on C vs A.

A ships in 3.1.7. C ships nothing user-visible in 3.1.7. The momentum
argument favors A (or at least B.i). The discipline argument favors C
(or B.ii — but B.ii's bundling problem makes C the cleaner expression
of the same discipline).

Project precedent: 3.1.6 close (e48e079) shipped after a 4-thread
read-only investigation that resulted in 13 artifacts and an
architecture-locked planning doc. 3.1.5 close (sub-bundle 3.1.5 line
512) was a "one-shot bulk pass" with no v2 changes — pure ops. 3.1
close (mech.6) shipped the Stage 1-6 pipeline with explicit op debt
recording. The pattern is "investigation produces a bundle that ships
clean", not "ship to keep momentum and document debt later".

C honors that pattern.

## 4. Mech decomposition for the recommended pick

3.1.7 sub-bundle: **"Stage 1 universe correction + availability-
authority resolution"**.

| Mech | What it does | Touches | Verifies |
|------|---|---|---|
| **3.1.7-mech.1** Variant-filter relocation (Stage 1 → tool stub) | Moves `availableForSale = true` EXISTS predicate out of Stage 1 SQL. Stage 1 returns ACTIVE + not-deleted + not-excluded + embedded + tag-filtered candidates without availability check. Adds variant-load to v2 tool stub for top-N (closes op debt #15). | `stage-1-hard-filters.server.ts`, `recommend-products-v2.server.ts`, `pipeline.server.ts` (no orchestrator change beyond signature pass-through), tests | Probe: per-fixture stage1 universe = 1,169 (vs 29 today). Probe: v2 tool stub output has populated `variantId`, `available` from real variant load. Vitest existing Stage 1 tests updated. New vitest test for variant-load happy path. |
| **3.1.7-mech.2** Stage 5 OOS-aware substitute pass | Adds Stage 5's deferred OOS-substitute logic (mech.5 D6's "rare case" that Thread 2 showed is the steady-state case). Substitute an available alternative when a top-K candidate is OOS at substitute time. Closes op debt #11 architecturally. | `stage-5-diversity.server.ts`, integration test scaffolding | Integration test that injects 1 OOS candidate into a top-N and asserts substitute fires. |
| **3.1.7-mech.3** Bulk-approve secondary axes (occasion, color_family, material, fit, season, size_range, style_type) | Re-runs `scripts/bulk-approve-tags.ts` with `--axes=occasion,color_family,material,fit,season,size_range,style_type` against `ai-fashion-store.myshopify.com`. Caveat: 50-product calibration sample skewed innerwear (op debt #10). | `scripts/bulk-approve-tags.ts` (no script changes; configuration only), DB writes via existing audit trail | Pre/post census artifact. Post-approve eval re-baseline (the first non-degenerate baseline; expected aggregateScore in 0.30–0.50 range). |
| **3.1.7-mech.4 (optional)** Vocabulary expansion (saree, shorts) | Manually approve a small number of saree + shorts tag candidates if any exist in PENDING_REVIEW. If none exist in catalog at all, document and defer to Phase 5 catalog-tagging. | `scripts/bulk-approve-tags.ts` invocation with `--axes=category` filter, or new approval helper | Per-product census + post-approve eval delta. |
| **3.1.7-mech.5** Sub-bundle close: re-baseline eval, capture artifacts, R3 retirement | Final eval run with mech.1-4 in place. Document new aggregateScore. RETIRE R3 = 0.0833 (set TO the new baseline; or convert to a quality ladder per Thread 2 artifact 17). HANDOFF amendment recording op debt #11 + #15 closures and any new debts surfaced. | HANDOFF.md, `docs/planning/3-1-7-stage-1-universe-correction.md` | Final eval baseline is the artifact. |

3.1.8 sub-bundle (downstream): **"v2 flip"**.

| Mech | What it does | Touches |
|------|---|---|
| **3.1.8-mech.1** Registry edit (the flip itself) | Single-seam registry edit per Thread 1 artifact 02. v1 → v2. | `registry.server.ts` |
| **3.1.8-mech.2** Dead-code removal of legacy `recommend-products.server.ts` | After flip ships and is verified, delete legacy tool. | `recommend-products.server.ts`, tests |
| **3.1.8-mech.3** Verification artifacts | Live storefront verification of add-to-cart through v2 path on dev shop. | Dev-shop chat session capture |

## 5. Decision-points-resolved

### a. Which option (a/b/c/d) — and whether multiple folded

**Reformulated answer: C.** With B.ii folded into C as the technical
content (variant filter relocation = mech.1; Stage 5 substitute =
mech.2). With D folded into C as mech.3 (bulk-approve secondary
axes). With E folded into C as optional mech.4. Each as its own mech
with own verification.

Original prompt's (a)/(b)/(c)/(d) labels: equivalent to (c) in spirit
("defer flip to fix coverage first") but with the deeper finding that
the bottleneck is variant availability, not tag coverage.

### b. Variant-loading: ships in flip mech or as precursor

**Precursor.** Variant-loading ships in 3.1.7-mech.1 (concurrent with
variant-filter relocation; both touch the same surface). The flip in
3.1.8 inherits a v2 tool stub that already populates variantId +
available correctly. Op debt #15 closes in 3.1.7-mech.1.

Reasoning: the design-correct answer to availability-authority
(artifact 24 Answer 2) puts variant-load in the v2 tool stub. The
flip itself doesn't need to know about variants once #15 is closed.

### c. R3 = 0.0833 threshold revision

**Retire R3 in 3.1.7-mech.5.** Replace it with a re-anchored quality
ladder tied to fixture-pass-rate against the new non-degenerate
baseline. Suggested ladder:

- R3.0 (post-3.1.7) = the actual aggregateScore observed after
  mech.1-4 ship (whatever it is — the empirical anchor pattern).
- R3.1 (target for 3.1.8 flip) = R3.0 × 1.0 (no regression).
- R3.2 (Phase 5 catalog tagging) = ≥ 0.50.

The "0.0833 floor" was always vacuous (set to the empirical value);
re-anchoring against a non-degenerate baseline restores the floor
concept's information content.

### d. Test strategy

**Per-mech verification, ship-as-you-go, per artifact 25.**

- 3.1.7-mech.1: probe-driven (universe expansion + variant-load) +
  vitest unit tests. New verification artifact: `.pr-3-1-7-mech-1-
  artifacts/per-fixture-stage1.json` showing universe = 1,169.
- 3.1.7-mech.2: integration test that injects OOS top-K candidate,
  asserts substitute fires. Verification artifact: integration test
  output.
- 3.1.7-mech.3: existing pre/post census via `scripts/bulk-approve-
  tags.ts` (already produces this format — see
  `.pr-3-1-mech-6-artifacts/bulk-approve-real-run.txt`). Eval
  re-baseline.
- 3.1.7-mech.4: per-product census + eval delta.
- 3.1.7-mech.5: final eval baseline + HANDOFF amendment.
- 3.1.8 flip mech: dev-shop chat session verification.

This pattern matches 3.1.6's verification artifacts approach
(verification stdout dumped to `.pr-X-artifacts/`, removed pre-commit).

## 6. Op debt to add during 3.1.7 close (#38 onward)

Continuing the flat-numbered scheme from 3.1.6 close at #37:

**38.** No standalone decision register. D-numbered locked decisions
live in per-mech source-file headers; numbering restarts per mech.
Citations need both mech AND file path. Consider consolidating to
`docs/decisions.md` or per-mech sections in `docs/planning/<sub-
bundle>.md`. (Surfaced by Thread 3 artifact 21.)

**39.** Stage 1 SQL test coverage is structural-only (vi.mock on
`prisma.$queryRawUnsafe`, asserts on SQL string). Zero behavioral
tests against real catalog data. A Stage 1 implementation that
returns 0 candidates for 8/12 production fixtures still passes its
own test suite. Future mechs touching Stage 1 should add behavioral
tests (or seeded test catalog).

**40.** R3 (post-eval-pass flip release gate) was set TO the empirical
baseline (0.0833) at mech.6 baseline. As a "don't regress" floor it
worked in form but was tautological in content (nothing was at risk
of regressing below). 3.1.7 retires it. Future release-gate locks
should distinguish empirical-anchor (the gate IS the value) from
quality-target (the gate is a goal value above current).

**41.** PR-2.2 calibration sample (50 products) overlap with the
structural variant universe (29 products) is approximately 1 product.
Future bulk-approve operations on a small calibration sample should
explicitly target structurally-eligible products (intersect with the
Stage 1 universe BEFORE selecting the calibration sample), not
arbitrary product sub-sets.

**42.** Op debt #11's "Phase 5 full-catalog tagging will resolve this
naturally" framing was wrong. Phase 5 tagging on the same unbuyable
catalog subset (1,140 products) wouldn't help any fixture. Phase 5
needs to address catalog-side variant inventory (sync gap, draft
products, OOS reality, etc.) BEFORE more tagging is the right work.
3.1.7-mech.1 (variant-filter relocation) makes this less urgent for
the recommendation engine; it remains relevant for catalog hygiene.

## 7. Out-of-scope explicit list (what 3.1.7 does NOT do)

- **The flip itself.** Moves to 3.1.8 (3.1.8-mech.1).
- **Legacy tool deletion.** Moves to 3.1.8 (3.1.8-mech.2).
- **Phase 5 multi-mode re-rankers** (ELECTRONICS, FURNITURE, BEAUTY,
  JEWELLERY, GENERAL hard-filter axes). Out of 3.1.7 scope per
  HANDOFF.
- **expectedHandles fixture curation** (op debt #9). Pre-3.2
  Midhun task; 3.1.7 doesn't address it. The eval scoring will
  continue using relaxed-match-only until Midhun curates handles.
- **Catalog-side variant inventory hygiene** (the underlying cause of
  the 1,140 unbuyable products). 3.1.7 makes the recommendation
  engine robust to it (mech.1 + mech.2) but doesn't fix the catalog
  data itself. Phase 5 onboarding work or a separate catalog-hygiene
  sub-bundle picks this up.
- **Order ingest + sales velocity + AttributionEvent** (sub-bundle
  3.2). Per HANDOFF, follows 3.1.7.
- **Stage 1 PENDING_REVIEW soften** (option B.iii). Crosses the
  APPROVED-only design line. Not in 3.1.7 scope.
- **Storefront API live-availability check at chat-widget render**
  (artifact 24 Answer 3). Not in 3.1.7 scope; documented for
  completeness.

---

This synthesis is the input to the planning-round close commit. The
planning artifact `docs/planning/3-1-7-stage-1-universe-correction.md`
can be authored from this synthesis directly. After authoring + the
HANDOFF amendment, 3.1.7 mech prompts are written one at a time,
matching the 3.1.6 close cadence.
