# Thread 1 synthesis — registry surface + flip-site verification

HEAD: `e48e079` (3.1.6 close). Working tree clean modulo `devlog.txt`.
Investigation: read-only.

## Premise corrections

The resume prompt referenced `app/lib/recommendations/registry.server.ts` and
implied a v1/v2 directory split under `app/lib/recommendations/`. Neither
exists at HEAD:

- **No `app/lib/recommendations/registry.server.ts`** — the recommendations
  directory has only `v2/` under it, no registry file.
- **No `app/lib/recommendations/v1/`** directory at all. v1 was never a
  separate sibling tree to v2; it was always the legacy chat tool stub.
- The actual "registry" is the chat tools registry at
  `app/lib/chat/tools/registry.server.ts`. It selects between
  `recommend-products.server.ts` (legacy, "v1") and the unregistered
  `recommend-products-v2.server.ts` (new, "v2").

Architecturally this is consistent with op debt #15's wording — it says
"flip = one-line registry change + variant-loading on v2 ProductCard." The
"registry" it refers to is the chat tools registry; the "v2 ProductCard" is
the data shape returned by the v2 pipeline (Stage 6 output), not a React
component.

The substance of op debt #15 is intact. The path is just not where the
resume prompt's path-string suggested.

---

## Question 1 — Where is the flip site?

**File:** `app/lib/chat/tools/registry.server.ts`
**Lines:** 11-14 (import block), 29 (return list), 38-42 (switch case body).

Three logical edits, ~8 changed lines. Detail in artifact `02`.

---

## Question 2 — Is it still one line?

**No — strictly, never was.** The "one-line registry change" claim from
op debt #15 is shorthand. The minimum viable flip in `registry.server.ts`
alone is **3 logical edits / ~8 changed lines** (import block + return list
+ switch case body). Could compress to one line via aliased imports, but
that's a syntactic trick, not a semantic one.

**More importantly:** the registry change alone is not sufficient for the
flip to ship. Op debt #15 explicitly couples the registry change to a
variant-loading dependency on the v2 ProductCard. Without that loading,
the flip is a **silent regression for storefront add-to-cart** —
`product.variantId` would be `null` on every recommended card, the widget
would treat them as OOS, and the Add-to-Cart button would disappear.

So the flip is:
- **Registry edit:** trivial. ~8 lines, mechanical.
- **Variant-loading:** non-trivial. New code, decision required (where to
  load — Stage 6 inside the orchestrator vs. v2 tool stub after the
  orchestrator returns), tests required.

---

## Question 3 — v1 vs v2 surface parity

**Signature-compatible. No cascading consumer changes required.**

| Surface                  | Match? | Notes                                        |
|--------------------------|--------|----------------------------------------------|
| Tool name                | ✅     | Both export `name: "recommend_products"`     |
| `input_schema` (Anthropic)| ✅     | Same fields: intent, price_min, price_max, limit |
| Function signature       | ✅     | `(input, ctx) => Promise<ToolResult>`        |
| `ToolResult.data` shape  | ✅     | products[], total, topDistance, query        |
| `ToolResult.products[]`  | ✅     | v2 ProductCard mirrors v1 + adds optional telemetry |
| Side effects             | ⚠️     | v2 writes `RecommendationEvent`; v1 doesn't  |

The side-effect difference is intentional (locked decision D7 in mech.6) and
desired — recommendation telemetry is a v2 feature. It does not cascade to
consumers; the agent + widget see identical wire shapes.

**No cascading consumer changes required.** Detail in artifacts `04` + `05`.

---

## Question 4 — Variant-loading state for v2 ProductCard

**Not wired.** `app/lib/recommendations/v2/stage-6-output.server.ts:166-167`
hardcodes `variantId: null` and `available: true`. The orchestrator at
`pipeline.server.ts:188-190` calls `formatProductCard` and passes those
placeholders through unchanged. The v2 tool stub
(`recommend-products-v2.server.ts`) also does not load variants.

Stage 6's own comment (lines 160-165) says the orchestrator was supposed
to load variants for surviving candidates before calling formatProductCard.
The orchestrator does not do this. mech.6 shipped with the placeholders
intact — that's the gap op debt #15 records.

**Adjacent gap discovered (not in op debt #15 but lives in the same load):**
`compareAtPrice: null` is also hardcoded in v2 Stage 6. v1 populates it
from the loaded variant. Any variant-loading mech that fixes #15 should
fix compareAtPrice in the same change — same data source, same load.

Detail in artifact `06`.

---

## Question 5 — Consumers affected by the flip

**One direct importer of the registry:**
`app/lib/chat/agent.server.ts:29` (imports `buildToolList` + `executeTool`).

**One route ultimately invoking the registry:**
`app/routes/api.chat.message.tsx:97` calls `runAgent`, which calls the
registry. This is the chat widget's only path.

**Zero non-chat consumers.** No cron, no worker, no other route, no test
file imports the registry.

**Eval harness:** unaffected. Eval invokes `runPipeline` directly via
`app/lib/recommendations/v2/eval/{cli,pipeline-runner}.ts` — bypasses the
registry. So the flip does not change eval behavior.

**Blast radius:** exactly one route handler (`api.chat.message`) and one
storefront surface (the chat widget JS in
`extensions/storefront-widget/assets/chat-widget.js`).

Detail in artifact `03`.

---

## Question 6 — Hidden flip sites

**None.** Grep for `recommend-products` imports finds only the registry
itself. The agent never imports a tool directly — it goes through the
registry seam (per registry.server.ts:8 file comment: "agent.server.ts
never imports individual tools — only this module."). No route handler
hardcodes the legacy tool. No worker / cron path bypasses the registry.

The flip site is one place, and it is the place op debt #15 said it was.

---

## Question 7 — Updated estimate of flip mech size

**Medium (2-3 mechs).**

Component breakdown:

1. **Variant-loading mech.** New code that loads `ProductVariant` rows for
   the surviving top-N candidates and populates `variantId`, `available`,
   and (recommended) `compareAtPrice` on the ProductCard. Two locations to
   choose from per op debt #15:
   - **Stage 6 itself** loads variants (one place, but ties Stage 6 to a
     prisma roundtrip — currently Stage 6 is pure compute).
   - **v2 tool stub** loads variants after the orchestrator returns
     (mirrors legacy tool's location, keeps orchestrator pure-compute).
   Decision belongs in Thread 3 / option-pick prompt. The cleaner option
   (per op debt #15 phrasing) is the tool stub.
   Tests required: variant-load happy path, variant-load with no variants
   (product → empty `availableForSale=true` set), respect of price filter
   in variant selection (lowest-price-available).

2. **Flip mech.** Three-edit change to `registry.server.ts`. Drops the v1
   tool stub from the agent path. After this, the legacy
   `recommend-products.server.ts` is dead code — flag for deletion in a
   follow-up cleanup mech, or delete in the same mech.

3. **Optional verification mech.** Live storefront verification of
   add-to-cart through the v2 path (extensions widget hits the flipped
   agent, captures one recommendation turn, confirms variantId populated
   and add-to-cart succeeds). Mirrors the artifacts pattern from 3.1.6
   mech.2.5 / mech.3.5.

**Cost/benefit signal for Thread 3 options:**

- Option (a) "ship the flip" is **NOT a one-line PR**. Re-cost as
  ~1.5-2 sub-mechs (variant-loading + registry-edit, ±verification). Still
  small in absolute terms — single sitting, no schema changes, no migration,
  no cron/worker touch. Verification artifacts are cheap.
- Options (b)/(c)/(d) compete against ~1.5-2 mechs of work, not against
  zero. Their cost/benefit improves modestly relative to (a) if measured
  against the original "one-line" framing, but the gap is small enough
  that (a) likely remains viable as a Thread 3 pick.

The flip is still architecturally clean (single seam, signature-compatible
v2 surface, contained blast radius). The "one-line" label was always
shorthand for the registry edit only; the variant-loading prerequisite was
already known from op debt #15. **No drift between 3.1 close and 3.1.6
close** — the surface looks the same as it did at mech.6, and no
intervening commit has touched `registry.server.ts`,
`recommend-products(-v2).server.ts`, `pipeline.server.ts`, or
`stage-6-output.server.ts`.
