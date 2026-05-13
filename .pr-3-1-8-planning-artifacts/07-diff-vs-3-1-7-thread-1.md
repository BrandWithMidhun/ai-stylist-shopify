# 07 — Diff vs 3.1.7 Thread 1

Tabular comparison of every captured aspect across the six verbatim/context
artifacts. 3.1.7 Thread 1 captured at HEAD `e48e079` (3.1.6 close); 3.1.8
Thread 1 captures at HEAD `d21abc0` (3.1.7 close). Intervening 3.1.7 mech
chain: mech.1 universe correction, mech.2 variant-load wire, mech.3
secondary-axis bulk-approve (+ mech.3a min-confidence flag), mech.4
category=shorts rule, plus mech.2.5/3.5/4.5 verification artifacts.

## Per-artifact diff

### Artifact 01 — registry.server.ts verbatim

| Aspect                                       | 3.1.7 Thread 1                 | 3.1.8 Thread 1 (current)       | Delta            |
|----------------------------------------------|--------------------------------|--------------------------------|------------------|
| File path                                    | app/lib/chat/tools/registry.server.ts | same                    | unchanged        |
| File size                                    | 51 lines                       | 51 lines                       | unchanged        |
| Imports (lines 11-14)                        | recommendProducts(Tool) from recommend-products.server | same | unchanged       |
| buildToolList return (line 29)               | [recommendProductsTool, searchProductsTool] | same                   | unchanged        |
| executeTool switch case body (38-42)         | calls recommendProducts(...)   | same                           | unchanged        |
| Comment block                                | "single seam" explanation      | same                           | unchanged        |

### Artifact 02 — flip-site context

| Aspect                                       | 3.1.7 Thread 1                 | 3.1.8 Thread 1 (current)       | Delta            |
|----------------------------------------------|--------------------------------|--------------------------------|------------------|
| Number of logical edits                      | 3                              | 3                              | unchanged        |
| Number of changed lines                      | ~8                             | ~8                             | unchanged        |
| Import block line range                      | 11-14                          | 11-14                          | unchanged        |
| Return list line                             | 29                             | 29                             | unchanged        |
| Switch case body line range                  | 38-42                          | 38-42                          | unchanged        |
| Edit substance                               | replace v1 symbols → v2 symbols| same                           | unchanged        |

### Artifact 03 — registry consumers

| Aspect                                       | 3.1.7 Thread 1                 | 3.1.8 Thread 1 (current)       | Delta            |
|----------------------------------------------|--------------------------------|--------------------------------|------------------|
| Direct importers of registry                 | 1 (agent.server.ts:29)         | 1 (agent.server.ts:29)         | unchanged        |
| User-visible route                           | api.chat.message.tsx:97        | api.chat.message.tsx:97        | unchanged        |
| Non-chat consumers                           | 0                              | 0                              | unchanged        |
| Test imports                                 | 0                              | 0                              | unchanged        |
| Refs to `recommendProductsTool` outside its own decl | 1 file (registry.server.ts) | 1 file (registry.server.ts) | unchanged        |
| Eval bypass intact                           | yes (runPipeline direct)       | yes (runPipeline direct)       | unchanged        |

### Artifact 04 — v1 public surface

| Aspect                                       | 3.1.7 Thread 1                 | 3.1.8 Thread 1 (current)       | Delta            |
|----------------------------------------------|--------------------------------|--------------------------------|------------------|
| File path                                    | recommend-products.server.ts   | same                           | unchanged        |
| File size                                    | 172 lines                      | 172 lines                      | unchanged        |
| Tool definition (name, schema)               | name=recommend_products, 4 fields | same                        | unchanged        |
| Function signature                           | (input, ctx) => Promise<ToolResult> | same                       | unchanged        |
| formatProductCard semantics                  | variant-loaded via findSimilarProducts | same                   | unchanged        |
| Variant-loading authority                    | v1 only (v2 was stubbed)       | v1 + v2 (mech.2 paired them)   | **paired**       |

### Artifact 05 — v2 public surface (the key artifact)

| Aspect                                       | 3.1.7 Thread 1                 | 3.1.8 Thread 1 (current)       | Delta            |
|----------------------------------------------|--------------------------------|--------------------------------|------------------|
| File path                                    | recommend-products-v2.server.ts | same                          | unchanged        |
| File size                                    | 203 lines                      | 203 lines                      | unchanged        |
| Tool def name                                | "recommend_products"           | same                           | unchanged        |
| Tool def input_schema                        | identical to v1                | identical to v1                | unchanged        |
| Function signature                           | (input, ctx) => Promise<ToolResult> | same                       | unchanged        |
| RecommendationEvent write                    | yes (D7)                       | yes (D7)                       | unchanged        |
| ProductCard.variantId in returned products   | **stub: null (always)**        | **real: extractNumericId(...) or null** | **populated** |
| ProductCard.available in returned products   | **stub: true (always)**        | **real: variant?.availableForSale ?? false** | **populated** |
| ProductCard.compareAtPrice in returned products | **stub: null (always)**      | **real: variant.compareAtPrice when meaningful** | **populated** |
| Stage 5.5 variant-load present in pipeline   | no                             | **yes (loadAndAttachVariants)**| **new**          |

### Artifact 06 — ProductCard references

| Aspect                                       | 3.1.7 Thread 1                 | 3.1.8 Thread 1 (current)       | Delta            |
|----------------------------------------------|--------------------------------|--------------------------------|------------------|
| Type 1 (chat tool ProductCard) definition    | types.ts:31-43, 11 fields      | same                           | unchanged        |
| Type 2 (v2 pipeline ProductCard) definition  | v2/types.ts:163-183            | v2/types.ts:178-198            | line shift only  |
| React component ProductCard.tsx              | admin dashboard only           | admin dashboard only           | unchanged        |
| Widget OOS check (line 839)                  | `!variantId || available===false` | same                        | unchanged        |
| Widget add-to-cart guard (line 898)          | requires numeric variantId     | same                           | unchanged        |
| Behavioral effect of widget logic on v2 cards| stub kicks every card to OOS   | **real wire kicks only true-OOS cards** | **fixed**  |
| Adjacent compareAtPrice gap                  | open (hardcode null)           | closed (sourced from variant)  | **fixed**       |

## Cross-cutting diagnostic question

> Has anything in 3.1.7's mech chain (mech.1 variant-filter relocation, mech.2
> variant-loading wire, mech.3 secondary-axis bulk approve, mech.4
> rule-engine pass) introduced a new surface area or broken parity in a way
> that affects the flip's shape?

**Answer: NO new surface area. NO broken parity. mech.2 affirmatively
CLOSED the parity gap that 3.1.7 Thread 1 captured.**

Per-mech accounting:

- **mech.1 (universe correction, variant-filter relocation).** Touched
  Stage 1 (SQL filter removal) and the Stage 1 D1 aggregate. None of this
  propagates to the v2 tool stub. The orchestrator output shape is
  unchanged; only the candidate-set composition shifted (universe
  correction). Flip-irrelevant.

- **mech.2 (variant-loading wire).** Closed op debt #15. Added
  `STAGE_VARIANT_LOAD` ("stage-5.5-variant-load") between Stage 5 and
  Stage 6 in pipeline.server.ts. Replaced Stage 6's three hardcoded
  placeholders (`variantId: null`, `available: true`, `compareAtPrice:
  null`) with values sourced from `c.loadedVariant`. Variant-load uses
  the same `orderBy: [{availableForSale: "desc"}, {price: "asc"}], take:
  1` rule as v1's findSimilarProducts. The wire ONLY affects the data
  inside the ProductCard return — the function signature and overall
  return shape are unchanged. Flip is now CLEANER (no variant-loading
  prerequisite bundled with the flip).

- **mech.3 + mech.3a (secondary-axis bulk approve / min-confidence flag).**
  Operates on ProductTag database state (flipping pending tags to
  APPROVED at >=0.8 confidence). No code change in the registry, the
  tool stubs, the orchestrator, or Stage 6. Pure data migration. Affects
  WHICH tags Stage 3 boosts on, not the surface shape. Flip-irrelevant.

- **mech.4 (category=shorts rule via rule-engine seed).** Adds a SEED_RULES
  entry. Like mech.3, this is a data-layer change (creates ProductTag
  rows tagged with axis=category, value=shorts). No code change in any
  flip-site file. Flip-irrelevant.

- **mech.{2,3,4}.5 verification artifacts.** Pure artifacts directories;
  no source-tree changes outside `.pr-*-artifacts/`. Flip-irrelevant.

## Headline number

**Of 3.1.7 Thread 1's six key claims, 5 still hold and 1 has changed
(positively).**

Claims that still hold:
1. Flip is ~3 logical edits / ~8 lines in registry.server.ts. ✅
2. v1↔v2 tool-stub signature parity is clean. ✅
3. One direct importer (agent.server.ts), one user-visible route
   (api.chat.message.tsx). ✅
4. Eval bypasses the registry. ✅
6. Chat widget treats true-OOS as OOS. ✅ (widget code unchanged; what
   changed is that v2 cards no longer trigger stub-driven false OOS).

Claim that has changed (positively):
5. Variant-loading was genuinely unwired. — **NOW WIRED**, via mech.2
   Stage 5.5. variantId / available / compareAtPrice are all real on
   v2 ProductCard returns. The "silent regression for storefront
   add-to-cart" risk that op debt #15 captured is closed.

## New findings surfaced by Thread 1

- The flip is now a SMALLER mech than 3.1.7 Thread 1 estimated. 3.1.7
  Thread 1's "1.5-2 sub-mechs" estimate bundled variant-loading with the
  registry-edit. Variant-loading shipped as 3.1.7 mech.2 (separately
  from the flip). The remaining flip is just the 3-edit/~8-line registry
  change plus tests plus an optional verification artifact — a single
  small mech.
- v1's `recommend-products.server.ts` becomes dead code post-flip. Same
  observation as 3.1.7 Thread 1; not a new finding, but worth noting that
  the variant-loading-closure does not change this. Deletion can land in
  the same commit as the flip or as a follow-up cleanup — that's a
  decision for the flip mech's prompt.
- The `available` field formula in v2's Stage 6 (line 182) is
  `variant?.availableForSale ?? false`. The pre-mech.2 stub was `true`.
  Post-mech.2 it falls through to `false` when no variant is loaded.
  This is the SAFER default (treats unknown as OOS at the widget) and
  matches v1's behavior — but it does mean a Stage 5.5 variant-load
  miss now produces an OOS card instead of a "let's-pretend-available"
  card. That's correct, but flag it for verification at flip time: a
  smoke test should confirm Stage 5.5 actually loads variants for the
  dev shop's catalog and the OOS rate post-flip is sane.
