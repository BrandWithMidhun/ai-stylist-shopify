# Availability authority — design question that gates 3.1.7 options

Threads 1+2 surfaced a split where three different layers of the
recommendation stack hold a different view of "is this product
buyable":

- **Stage 1** (`stage-1-hard-filters.server.ts:86-89`): hard EXISTS
  filter on `ProductVariant.availableForSale = true`. Authoritative
  at *Stage 1 entry*.
- **Stage 6** (`stage-6-output.server.ts:166-167`): hardcoded
  `variantId: null`, `available: true`. Stub data — Stage 6 is unaware
  of variant state because Stage 1 doesn't load variant rows (only
  EXISTS-checks). Authoritative at *output formatting*: nothing.
- **v2 tool stub** (`recommend-products-v2.server.ts:107-118`): passes
  Stage 6's stub through to the agent + widget unchanged. Authoritative
  at *agent-visible boundary*: still nothing.
- **Storefront chat widget** (`chat-widget.js:839,898`): treats
  `variantId=null || available=false` as OOS, hides Add-to-Cart.
  Authoritative at *user-visible UI*.

The result today: variant data is checked in Stage 1 (gate), then
ignored across Stages 2-6, then re-checked structurally at the widget.
This works for v1 because v1's `recommend-products.server.ts` loads
variants in `formatProductCard` from the DB roundtrip, populating
`variantId` and `available` from real data. It is broken in v2 because
v2 dropped the variant load from the candidate path (Stage 1 is EXISTS-
only, no relation load) and Stage 6 stubs the absent fields.

This isn't an option to pick — it's a **design decision that gates
options A, B.i, B.ii, and C.** Each option implicitly assumes a
different answer.

## Three coherent answers

### Answer 1 — Stage 1 owns it (status quo, preserve)

**Posture:** Variant availability is a hard-filter input to retrieval.
Products without available variants don't enter the pipeline. Stage 6's
stub is a bug fixed by loading variants for top-N before formatting
output. Chat widget is correct as-is.

**Implementation:** Variant-load mech (op debt #15) lands in v2 tool
stub or Stage 6. Stage 1 unchanged. Stage 5 OOS-substitute remains
deferred (op debt #11 unchanged). 29-universe stays the structural cap.

**Compatible with options:** A (with variant-loading mech), B.i, C
(if C only fixes the variant-loading question and leaves the universe
problem to a separate sub-bundle).

**Trade-off:** Universe cap stays at 29 products. Eval stays at 0.0833.
v2 ships, but the system's recommendation surface is bottlenecked on
catalog-side variant inventory health, not on engine improvements.

### Answer 2 — Stage 6 / v2 tool stub owns it (B.ii path)

**Posture:** Variant availability is a display concern. Stage 1 returns
all ACTIVE+embedded products; Stage 6 (or v2 tool stub) loads variants
for the top-N and either drops OOS items or marks them with
`available=false` for the widget to handle.

**Implementation:** Move variant EXISTS predicate out of Stage 1; load
variants in Stage 6 / tool stub for top-N; either filter OOS at output
time or pass them through with `available=false`. Stage 5 needs an OOS-
aware substitute pass (the work mech.5 D6 deferred).

**Compatible with options:** B.ii.

**Trade-off:** Universe expands to 1,169. More candidates, more
diversity. But: agent-visible recommendations might include OOS items
for edge cases (mid-pipeline-flip per mech.5 D6's "rare" case becomes
common when Stage 1 stops pre-filtering). Big surface, multi-mech.
This is the architecturally cleaner answer.

### Answer 3 — Chat widget owns it (Storefront API at render time)

**Posture:** Variant availability is checked at render time via Shopify
Storefront API. Pipeline returns products without variant load; widget
calls Storefront `cart/add.js` (or its `?variant=…` lookup) to confirm
availability before showing Add-to-Cart.

**Implementation:** Stage 1 stops EXISTS-checking variants. Stage 6
returns `variantId=<best-guess>`, `available=<unknown>`. Widget refresh
flow checks `availableForSale` at render via Storefront API; falls back
to "Out of Stock" UI if the Storefront says no.

**Trade-off:** Most decoupled. Most network-heavy. Adds a per-product
Storefront roundtrip on every recommendation render. Storefront API is
the real source of truth (live inventory) — but pulling it from the
widget means latency + auth complexity in the chat embed. Not
considered a 3.1.7 option; documented for completeness.

## Cross-reference to options

| Option | Implicit availability authority | Notes |
|--------|--------------------------------|-------|
| A — Ship flip v2-as-is | Answer 1 (Stage 1 owns) — but with variant-loading still missing → BROKEN | The "broken" part is op debt #15. A only ships if #15 ships first. |
| B.i — Soften Stage 1 on empty | Answer 1 still — but with a fallback path that bypasses the gate. Inconsistent: Stage 1 is "the authority except when it returns 0" | Architecturally weakest because it splits the authority between two states. |
| B.ii — Move filter out of Stage 1 | Answer 2 (Stage 6 / tool stub owns) | Cleanest answer to the design question, biggest surface to ship. |
| C — Defer flip; fix universe first | Answer 1 OR Answer 2 — C doesn't pre-commit | C buys time to make the answer-2 commitment correctly in 3.1.8. |
| D — Bulk-approve more axes | Orthogonal to availability authority | D is a tagging-coverage move; doesn't change which layer owns availability. |
| E — Vocabulary expansion | Orthogonal | E is a per-value APPROVED expansion; doesn't change layer authority. |

## Recommendation for the design question

**Answer 2 (Stage 6 / v2 tool stub owns availability)** is the right
long-term answer. Reasoning:

1. **Stage 1 is a retrieval-narrowing stage, not a buyability gate.**
   Coupling retrieval to current inventory makes the recommendation
   pipeline brittle on inventory churn. Inventory status changes
   minute-to-minute on a real store; embeddings + tag tags change
   day-to-day. Mixing them at Stage 1 makes the cheap layer
   (retrieval) sensitive to the volatile layer (inventory).

2. **Stage 6 / v2 tool stub already touches per-product DB rows for
   top-N formatting.** Adding a variant-load roundtrip here costs
   one query per recommendation call (cheap) instead of pre-filtering
   1,140 products at retrieval time (which costs nothing in queries
   but costs everything in pipeline candidate set).

3. **Op debt #15's "cleaner, mirrors legacy tool" preference (variant-
   load in v2 tool stub) is consistent with this answer.** The legacy
   tool loads variants for its top-N candidate pool; v2 should do the
   same. Stage 6 stays pure-compute (consistent with mech.6 D7's
   orchestrator-pure-compute principle).

4. **Stage 5 needs the OOS-substitute mech anyway** (op debt #11). The
   "deferred when caught" framing of mech.5 D6 was based on the false
   assumption that Stage 1 EXISTS handles steady state. Thread 2
   showed steady state IS the problem. Building Stage 5 substitute now
   is overdue, not premature.

But — and this matters for the option pick — answer 2 is a **multi-
mech effort** (variant filter relocate + Stage 5 substitute + Stage 6
variant load + v2 tool stub + tests + eval re-baseline). It does not
fit cleanly into "the post-eval-pass flip commit" (mech.6 D6's
phrase). It is a sub-bundle of its own.

## Implication for option pick

If the right design answer is Answer 2, then:
- Option A (flip-as-is) ships against Answer 1 → ships against the
  wrong answer.
- Option B.i (soften Stage 1) ships against a fragmented Answer 1 →
  worse than A.
- Option B.ii (relocate filter) ships Answer 2 → correct, but big.
- **Option C (defer flip; ship Answer 2 work first; flip in 3.1.8)
  is the design-correct path.** Lets Answer 2 land as its own sub-
  bundle without the flip mech tangled in.

This pre-commits the Thread 3 recommendation. See artifact 26.
