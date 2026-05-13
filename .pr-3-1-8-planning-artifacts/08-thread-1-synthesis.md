# Thread 1 synthesis — flip-site re-verification at 3.1.7 close

HEAD: `d21abc0` (Sub-bundle 3.1.7 close). Working tree clean modulo `devlog.txt`.
Investigation: read-only.

## Headline

**Of 3.1.7 Thread 1's six key claims, 5 still hold and 1 has changed
positively.** The flip site is in exactly the same place, with exactly the
same shape, against a STRICTLY STRONGER v2 surface than 3.1.7 planning round
anticipated. mech.2's variant-loading wire (which 3.1.7 Thread 1 estimated
as a bundled prerequisite of the flip) shipped separately as PR-3.1.7-mech.2,
closing op debt #15. The remaining flip mech is the bare 3-edit / ~8-line
registry change — a single small mech.

## Section 1 — Re-verification verdict

| # | 3.1.7 Thread 1 claim                                                    | Status at d21abc0     | Notes                                                                                  |
|---|-------------------------------------------------------------------------|-----------------------|----------------------------------------------------------------------------------------|
| 1 | Flip is ~3 logical edits / ~8 lines in registry.server.ts               | **still holds**       | File byte-identical; line numbers 11-14 / 29 / 38-42 unchanged.                         |
| 2 | v1↔v2 surface parity is clean (signature-compatible)                    | **still holds**       | Same name, same input_schema, same return type. Description wording differs but irrelevant. |
| 3 | One direct importer (agent.server.ts), one user-visible route           | **still holds**       | agent.server.ts:29 only. api.chat.message.tsx:97 only. No new consumers introduced.     |
| 4 | Eval bypasses the registry (calls runPipeline directly)                 | **still holds**       | eval/pipeline-runner.server.ts + eval/cli.ts unchanged.                                 |
| 5 | Variant-loading was genuinely unwired (variantId/available stubs)        | **has changed (closed)** | mech.2 added Stage 5.5 `loadAndAttachVariants`; Stage 6 now sources variantId/available/compareAtPrice from `c.loadedVariant`. Op debt #15 closed. |
| 6 | Chat widget treats stubs as OOS, hiding Add-to-Cart                     | **still holds (mechanism unchanged; behavior now correct)** | Widget code at lines 839/898 unchanged. Pre-mech.2: stubs forced every v2 card to OOS. Post-mech.2: only true-OOS cards (no variant / unavailable variant) go OOS. Correct end state. |

**No new finding falsifies a prior 3.1.7 Thread 1 claim.** The single
"changed" entry is closure of a known prerequisite — the flip became
cheaper, not more expensive.

## Section 2 — 3.1.7 chain's impact on the flip site

Per-mech accounting against the flip site and its dependencies:

- **mech.1 (universe correction).** Touched Stage 1 SQL filter and Stage 1
  D1 aggregate; neither propagates to the v2 tool stub or the registry.
  Flip-irrelevant.
- **mech.2 (variant-loading wire, closes op debt #15).** Added
  `STAGE_VARIANT_LOAD` ("stage-5.5-variant-load") between Stage 5 and
  Stage 6 in `app/lib/recommendations/v2/pipeline.server.ts`. Replaced
  Stage 6's three hardcoded placeholders (`variantId: null`,
  `available: true`, `compareAtPrice: null`) with values sourced from
  `c.loadedVariant`. Mirrors v1's findSimilarProducts variant rule
  (`orderBy: [{ availableForSale: "desc" }, { price: "asc" }], take: 1`).
  **Flip-positive impact.** The v2 surface is now strictly stronger than
  3.1.7 planning round anticipated; flip's "1.5-2 sub-mech" estimate
  collapses to single small mech.
- **mech.3 + mech.3a (secondary-axis bulk approve / min-confidence flag).**
  Pure data migration (ProductTag PENDING→APPROVED at >=0.8). No code
  change to registry, tool stubs, orchestrator, or Stage 6. Affects
  WHICH tags Stage 3 boosts on, not surface shape. Flip-irrelevant.
- **mech.4 (category=shorts rule via rule-engine seed).** Adds a
  SEED_RULES entry; produces ProductTag rows. No code change in any
  flip-site file. Flip-irrelevant.
- **mech.{2,3,4}.5 verification artifacts.** Pure `.pr-*-artifacts/`
  directories. Flip-irrelevant.

## Section 3 — Open questions for 3.1.8 mech.1 prompt time

These are NOT decisions for the planning round; they're items the flip
mech's prompt should resolve when it lands.

- **Exact line numbers.** Currently 11-14 (import block), 29 (return
  list), 38-42 (switch case body). If Threads 2/3 surface any work that
  modifies registry.server.ts before the flip ships (none is currently
  anticipated), line numbers should be re-confirmed at mech.1 prompt time.
- **Whether to delete `recommend-products.server.ts` in the same commit
  or as a follow-up cleanup.** Post-flip, the legacy tool stub is dead
  code with no remaining importer (registry.server.ts was the only
  consumer per artifact 03). Same-commit deletion is the cleaner shape;
  separate cleanup commit is the safer rollback story. Flip mech's
  prompt should choose.
- **Test surface.** Which tests assert against v1's behavior vs v2's
  behavior? The grep in artifact 03 showed zero test imports of
  registry.server.ts directly. Some agent integration tests likely
  exercise the registry → tool stub → return chain; the flip mech's
  prompt should enumerate them and decide which need updating.
- **Verification artifact.** The 3.1.7 mech-X.5 pattern (artifacts captured
  pre-commit, deleted, then re-captured deliberately post-PR) is the
  proven baseline. The flip's verification artifact should at minimum
  capture: a live storefront recommendation turn at d21abc0+flip-SHA,
  with variantId/available real on every returned card, and the chat
  widget's add-to-cart firing successfully. Decision: bundle .5 with
  flip mech as one commit, or split into separate mech.1 / mech.1.5? The
  pattern says split.

## Section 4 — Recommendation for 3.1.8 Thread 1 closure

**Based on this thread's findings alone: 3.1.8-mech.1 (the flip itself) is
ready to be scoped as a single small mech (~3 logical edits + tests +
maybe a follow-up .5 verification artifact mech). 3.1.7's mech chain did
NOT surface reasons to bundle additional work with it. The flip is
strictly cheaper now than 3.1.7 planning round estimated.**

Caveats deferred to planning-round close:

- **Thread 2 (prerequisite triage of op debts #43/#45/#46/#49/#51) may
  surface closures that bundle naturally with the flip.** Wait for Thread
  2's verdict before locking 3.1.8-mech.1's scope.
- **Thread 3 (ranking-gap fork resolution) may surface fixes that gate
  the flip.** If Thread 3 picks a fix that depends on the v2 surface
  shape, the flip's ordering vs that fix is a planning-round-close
  decision. (Predicted: Thread 3's fix(es) are orthogonal to the flip
  surface — the gap is about ranking quality, not data completeness —
  but verify.)

If Thread 2 surfaces no flip-prerequisite closures and Thread 3 surfaces
no flip-gating fix, then 3.1.8-mech.1 ships as scoped in the resume
prompt: a single small mech. Otherwise the planning round's locked
decisions table adjusts.

## Section 5 — Op debts surfaced by Thread 1 alone

**None.** No new op debt arises from this thread's investigation.

(Op debt #15 is now closed — verified by artifacts 05 and 06. No new
consumer cascade, no surface mismatch nobody had noticed, no
v1-deletion-blocker, no Stage-5.5-coverage gap visible. The future op
debt numbering pointer at #52 remains where it was, awaiting Threads 2
and 3.)

## Predictions vs reality (for future-self comparison)

The resume prompt predicted:

> Predicted answer: 3.1.8-mech.1 is ready to be scoped as a small single
> mech (~3 edits + tests + 1-2 verification artifacts). But await Threads
> 2 and 3 before locking the architecture.

**Realized.** Thread 1's investigation supports the predicted shape.

> Predicted answer: no, variant-loading was the only mech that touched
> the v2 ProductCard surface and it closed op debt #15 (making the surface
> MORE complete, not less). But verify.

**Verified.** Only mech.2 touched the v2 ProductCard surface; the touch
was strictly additive (closed three stub fields, added one Stage 5.5
contribution to the trace), and 100% in the direction of v1 parity.

The 5% surprise this thread was meant to catch — "mech.X accidentally
broke surface parity" — did not fire. The chain is clean.
