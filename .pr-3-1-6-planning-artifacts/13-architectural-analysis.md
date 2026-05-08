# Sub-bundle 3.1.6 planning — architectural analysis

Author: Claude Code (continuous-execution mode), planning round 2026-05-08.
Inputs: Threads 1, 2, 2.5, and the Thread 3 prompt.
Status: Planning deliverable. Mech.1 prompt will reference this document for the locked decisions.

---

## Section 1: Code surface findings

### What the existing chain does

The DELTA path is the one place in the codebase that detects content drift on a recurring basis:

- `webhooks.products.{create,update,delete}.tsx` enqueue a `CatalogSyncJob` DELTA via `enqueueDeltaForShop`. webhook-driven DELTAs land with `triggerSource=null`; cron-tick-driven DELTAs land with `triggerSource="CRON"`.
- `worker-phase-products.ts` paginates the delta window, calls `upsertProductKnowledge` per product. That function computes a fresh `knowledgeContentHash` and writes it (along with `knowledgeContentHashAt = now`) on every upsert, regardless of whether the hash actually changed. The boolean `hashChanged` is returned to the caller.
- The caller pushes `hashChangedProductIds` into a list and, **after the upsert tx commits**, enqueues a `SINGLE_PRODUCT` `TaggingJob` per id with `triggerSource="DELTA_HASH_CHANGE"` (line 155). The enqueue is intentionally outside the tx — an enqueue failure must not poison the sync.

`enqueueTaggingForProduct` constrains `kind` to `SINGLE_PRODUCT | MANUAL_RETAG`. **It does not enqueue `RE_EMBED`.** RE_EMBED is only ever enqueued by `scripts/bulk-reembed-products.ts` (the 3.1.5 survivor) and by the mech.6 hand-test. There is no automatic embed-refresh path in production.

### The skip predicate

`worker-reembed.ts:139-141` (Decision A):
```ts
const skip =
  product.embeddingContentHash !== null &&
  product.embeddingContentHash === product.knowledgeContentHash;
```

This is a complete predicate **for the case where embedding text is fully derivable from the knowledge hash inputs**. It is incomplete for the actual codebase. See Finding 1 below.

### Finding 1 — The skip predicate misses tag-only drift (high-impact)

`knowledge-hash.server.ts:13-17` documents the deliberate exclusion of `ProductTag` rows from `knowledgeContentHash`:

> "ProductTag rows (AI tags) — Phase 2 generates those *from* the knowledge record; circular dependency"

But the embedding text **does** include `product.tags` (i.e. `ProductTag` rows): `product-embedding.server.ts:57-62` formats them as `axis:value` and appends them as an `Attributes:` line. The query at `worker-reembed.ts:105` selects all tags with no status filter.

The asymmetry creates a concrete failure mode:

1. AI tagger (SINGLE_PRODUCT) runs against a product, rewrites `ProductTag` rows.
2. `knowledgeContentHash` does not change (input set is unchanged).
3. `embeddingContentHash` matches `knowledgeContentHash` (from the previous embed pass).
4. Decision A says "skip" — but the embedding text *would* differ if rebuilt because tags changed.
5. Embedding stays stale relative to the tags retrieval will use.

This means **even with Option A, B, or C wired correctly, a re-tag run that doesn't co-occur with knowledge change will leave a stale embedding.** The most defensible response is to enqueue RE_EMBED on SINGLE_PRODUCT completion (D1 option ii), turning the skip predicate into a safety net for the scheduled-redo case rather than the load-bearing trigger.

### Finding 2 — Embedding includes unapproved tags

`worker-reembed.ts:105` queries `tags: { select: { axis, value } }` with no `status` filter. PENDING_REVIEW and REJECTED tags both feed the embedding. Stage 1 of v2 retrieval requires APPROVED tags; the embedding doesn't gate on the same status. This isn't a 3.1.6 bug (it predates Phase 3), but it's adjacent: any cleanup of "what does RE_EMBED read" should land at the same time, since the answer affects what the skip-predicate gap looks like.

Recommendation: add `where: { status: 'APPROVED' }` to the tags select inside worker-reembed.ts as part of 3.1.6 mech.1. One-line change. Aligns embedding inputs with retrieval inputs. Adds a third trigger condition (tag flips PENDING_REVIEW → APPROVED) to the recurring-sync gap that's worth addressing.

### Finding 3 — NULL-knowledgeContentHash signal exists in production but is unused

`bumpHashForMetaobjectReferents` (`knowledge-upsert.server.ts:457-481`) sets `knowledgeContentHash=NULL` on every Product row that references a touched metaobject GID. The PR-C author tagged this as "the explicit stale signal Phase 3's re-embed path will key off of" (line 469-472).

No scanner reads this signal today. But: if a NULL-hash row is enqueued for RE_EMBED via any mechanism, Decision A correctly fires (because `NULL === '<hex>'` is false → skip=false → re-embed). The handler is ready; only the enqueue path is missing. This makes Option B / C cheap: the consumer infrastructure already exists.

### Finding 4 — Inline enqueue at the existing call site is structurally easy

`worker-phase-products.ts:99-101` already commits to "enqueue is outside the upsert transaction by design — an enqueue failure should not abort the catalog sync." A second enqueue (RE_EMBED) at the same site inherits this failure-isolation story. The shape of the new helper is mechanical mirror of `enqueueTaggingForProduct` swapped to `kind: "RE_EMBED"`.

### Finding 5 — No formal FIFO guarantee in the worker claim loop

The tagging loop in `worker-tagging.ts` claims jobs serially but with no SQL-level ordering guarantee that two jobs enqueued back-to-back will drain in enqueue order. Under low contention (the dev shop's reality) ordering is observed in practice, but design must not depend on it.

### Finding 6 — SINGLE_PRODUCT completion is the canonical "tags changed" signal

Independent of the DELTA-hashChanged path, every SINGLE_PRODUCT job that completes successfully has rewritten `ProductTag` rows for one product. Wiring RE_EMBED on completion solves both the AI-tag-drift gap (Finding 1) and trivially handles the chronologically-sequenced ordering (D1 option ii).

---

## Section 2: Option evaluation

| Criterion | Option A: inline | Option B: NULL scanner | Option C: hybrid |
|---|---|---|---|
| **1. Closes empirical gap (5/3 elite-linen-styling-service)** | ✓ direct hit | ✓ scanner picks up `embeddingContentHash != knowledgeContentHash` rows post-DELTA | ✓ via inline path |
| **2. Closes metaobject NULL fan-out gap** | ✗ misses entirely (the fan-out doesn't go through the DELTA path) | ✓ scanner finds NULL-hash rows directly | ✓ via scanner half |
| **3. Code surface area** | smallest: 1 helper + 1 call site + 1 test (~60 LOC) | medium: scanner module + cron wiring or post-DELTA hook + 2 tests (~150 LOC) | largest: helper + call site + scanner + 3 tests (~200 LOC) |
| **4. Race conditions vs SINGLE_PRODUCT** | RE_EMBED + SINGLE_PRODUCT enqueued back-to-back; no formal ordering. With Finding 1's tag-drift semantics, ordering wrong-way means stale embedding text. Mitigation requires D1 ii. | scanner runs as a separate pass — naturally lags AI-tag completion, but no inter-job race on a single product | inherits A's race for hashChanged path; scanner is independent |
| **5. Observability** | `triggerSource="DELTA_HASH_CHANGE"` differentiates these from the bulk INITIAL_BACKFILL pass | needs a new triggerSource value (e.g. `"NULL_HASH_SWEEP"`) — additive, no migration | both triggerSources differentiate cleanly |
| **6. Idempotency** | partial unique index `(shopDomain, productId) WHERE status='QUEUED'` defends; same dedup behaviour as `enqueueTaggingForProduct` | scanner must check inflight RE_EMBED rows before enqueueing OR rely on the index — both work | both: index defends inline; scanner must dedup against inflight |
| **7. Cost discipline** | Decision-A skip predicate short-circuits on subsequent runs if knowledge unchanged; per Finding 1, AI-tag-drift case will wastefully re-enqueue but Voyage cost is $0.00002/job — negligible at dev-shop scale, may matter at 100k-product scale | scanner runs on schedule (e.g. once per cron tick per shop); query is `embeddingContentHash != knowledgeContentHash OR knowledgeContentHash IS NULL` filtered by ACTIVE/not-deleted/not-excluded — bounded by drift rate; expected near-zero in steady state | inline path produces enqueues during DELTA; scanner sweeps remainders. Inline is cheaper per-event, scanner catches the long tail |
| **8. Failure mode** | enqueueTaggingForProduct throws→swallowed→logged; same shape applies. Worst case: SINGLE_PRODUCT enqueued, RE_EMBED enqueue fails, AI-tag completes, embedding stays stale until next DELTA touches the product | scanner failure means no scan that pass; next pass picks up the unchanged stale set | inline failure caught by scanner on next sweep; defense in depth |

---

## Section 3: Recommendation

### Pick Option C, modified.

The framing of "A vs B vs C" gets sharper once Findings 1 and 6 are taken into account. The actual recommended shape is:

1. **Wire RE_EMBED enqueue at SINGLE_PRODUCT *completion***, not at the DELTA-hashChanged enqueue site (modifies what Option A/C means in practice — see D1 below).
2. **Build the NULL-hash scanner as a backstop.** Runs on each cron tick (1×/day per shop in current cadence; trivially scaled). Picks up metaobject fan-out rows, manual NULL writes, and any inline-path failures.

This is Option C in spirit but with a different "inline" half: instead of two parallel enqueues at the DELTA call site, the `worker-tagging.ts` SINGLE_PRODUCT handler enqueues a RE_EMBED on its own SUCCEEDED path. The scanner closes the rest.

### Why this over straight A or B

- **Straight Option A** is the smallest commit but does not close the AI-tag-drift gap (Finding 1) or the metaobject NULL fan-out gap (Finding 3). It would land mech.1, then need a follow-up commit to fix Finding 1, then another for the NULL fan-out — three small commits that could have been one larger one.
- **Straight Option B** (scanner only) is functionally complete but loses the tight per-event coupling. A merchant who flips a product's content via webhook would wait until the next cron tick (up to 24h) for the embedding refresh. That latency is acceptable for the metaobject case (rare, low-stakes) but feels wrong for the products-update case (frequent, recommendation-impacting).
- **Modified C** (handler-completion enqueue + scanner backstop) gives near-real-time updates on the events that matter (DELTA hashChanged, metaobject fan-out, manual retags, future un-exclude triggers) while keeping a defensive sweep for everything else.

### Trade-offs accepted

- **Coupling**: `worker-tagging.ts` SINGLE_PRODUCT handler will need to know about RE_EMBED enqueue. The two worker paths were independent until now. The coupling is one-way (tagging knows about embed; embed doesn't know about tagging) and small. Comment-discipline can keep the dependency direction documented.
- **Wasted Voyage calls**: every SINGLE_PRODUCT completion produces a RE_EMBED enqueue, but Decision-A short-circuits when nothing actually drifted. Wasted cost is the worker's overhead to claim+skip a job (~10ms × 1 DB roundtrip) — not the Voyage call. At dev-shop scale: negligible. At 100k-product scale during a manual full-retag: ~17 minutes of single-claim worker time spent skipping. Acceptable.
- **Two enqueue paths instead of one**: the inline-completion path and the scanner. Both are simple. The scanner is the safety net; in steady state it should find zero drifted rows and complete in <1s.

---

## Section 4: Adjacent decision recommendations

### D1 — Job ordering

**Recommend D1 (ii) chained: SINGLE_PRODUCT-completion enqueues RE_EMBED.**

This is the actual content of the recommendation in Section 3. Justification re-stated:

- The embedding text includes ProductTag rows (Finding 1).
- `knowledgeContentHash` deliberately excludes them.
- Decision A's skip predicate is therefore an incomplete proxy for "embedding is fresh".
- Ordering "tags first, then embed" is the only way to keep the embedding aligned with the tag state without redesigning the hash.
- Chaining at handler-completion is structurally simpler than chaining at enqueue-time + relying on FIFO (Finding 5 rules out the latter).

### D2 — Op debt #21 (handler-side defensive status check)

**Recommend fold into 3.1.6 mech.1.**

Justification: the scanner from Modified Option C can enqueue RE_EMBED for products that flip ACTIVE → DRAFT between scan and claim. The handler must defend. The check is ~10 lines (re-read product, abort with `summary.skipped=true, summary.reason='status_changed'`). Splitting to 3.1.7 means landing the recurring-sync wire knowing it has a known stability hole — bad shape for a sub-bundle whose whole purpose is "make recurring sync robust".

### D3 — Op debt #20 (un-exclude trigger)

**Recommend defer to a separate small commit, but in 3.1.6's window.**

Justification: the wire lives in the products/update webhook handler, not in the worker. It's structurally separate from the rest of 3.1.6's work. But it's the same conceptual gap (recurring sync misses a class of state changes), so landing it adjacent to 3.1.6 is right. Keeping it as its own commit makes the diff trivially reviewable. Could be PR-3.1.6-mech.4 or a sibling housekeeping commit.

### D4 — CatalogSyncJob.summary forensics extension

**Recommend fold into 3.1.6 mech.1.**

Justification: shape change is additive (just three new keys: `embeddingsEnqueued`, `embeddingsAlreadyQueued`, `embeddingsSkippedNotEligible`). No migration needed (Json column). Adding observability when wiring new automation is cheap and pays back the first time something goes sideways. The same data could be reconstructed from TaggingJob queries, but having it inline in the DELTA summary makes the dashboard story coherent.

Recommend extending the SINGLE_PRODUCT handler's `summary` similarly when it enqueues a follow-up RE_EMBED: `embedRefreshEnqueued: true|false`. Same justification.

### D5 — `triggerSource` literal-union type

**Recommend split to a complementary housekeeping commit, before or after 3.1.6.**

Justification: the discipline payoff is real (catches future drift like the lone production "WEBHOOK" row). The blast radius is small (touch every enqueue call site to import the type). But it's not load-bearing for 3.1.6 and adds reviewer noise to the diff. Cleaner as its own one-commit pre-3.1.6 hygiene step.

Recommend the TS literal-union form, not a Prisma enum. Enum forces a migration; literal-union is a compile-time guard that doesn't reach the DB.

---

## Section 5: Mech-commit shape

Recommended split:

**PR-3.1.6-mech.1: Core wire + skip-predicate alignment.**
- `enqueueReembedForProduct` helper in `app/lib/catalog/enqueue-tagging.server.ts` (mirror of `enqueueTaggingForProduct`, kind=RE_EMBED).
- `worker-tagging.ts` SINGLE_PRODUCT handler enqueues a follow-up RE_EMBED on SUCCEEDED path with `triggerSource="POST_TAG_SYNC"` (or `"AI_TAG_COMPLETE"` — pick at mech.1 prompt time).
- Worker-reembed.ts handler: add `where: { status: "APPROVED" }` to the tags select (Finding 2 cleanup) — affects skip predicate semantics consistency.
- Worker-reembed.ts handler: defensive status check at claim time (D2). New skip reason `"status_changed"`.
- New unit tests: both handlers exercise the new paths (positive: enqueue happens, defensive: skip on status flip).
- CatalogSyncJob.summary additive shape change in worker-phase-products: `embeddingsEnqueued` etc. (D4).
- ~250 LOC, 4-5 new tests.

**PR-3.1.6-mech.2: NULL-hash scanner.**
- New module `app/lib/catalog/null-hash-scanner.server.ts`. Pure function returns an array of productIds that need RE_EMBED.
- Integration point: cron-tick.server.ts runs the scanner per shop after the existing DELTA enqueue, fanning out RE_EMBED enqueues for each result. New triggerSource `"NULL_HASH_SWEEP"`.
- Bounded query (filter by ACTIVE/not-deleted/not-excluded; LIMIT to a configurable cap with an env override — e.g. 500/sweep). Documented in the scanner module.
- Unit tests on the scanner predicate. Integration test on the cron-tick wire.
- ~150 LOC, 3 new tests.

**PR-3.1.6-mech.3: products/update webhook un-exclude trigger (D3).**
- In `webhooks.products.update.tsx`, fetch prior `recommendationExcluded` value, compare against payload's value (or fetch from a separate Admin API call if payload doesn't carry it — verify), enqueue RE_EMBED on `true → false` transition.
- New triggerSource `"UN_EXCLUDE"`.
- ~30 LOC + 1 webhook test.

**PR-3.1.6 close (no mech designation):** verification pass against dev shop (does the next DELTA fan out RE_EMBED correctly? does the next AI-retag fan out RE_EMBED? does the metaobject fan-out path get caught by the scanner?), HANDOFF amendment, op debt updates, artifacts.

If mech.3 needs verification dependencies on mech.1 + mech.2, sequence them in order. If they're independent enough, mech.2 and mech.3 can land in either order after mech.1.

**Total mechs: 3, plus close.** Comparable to 3.1's 6-mech split, smaller because the scope is narrower.

---

## Section 6: Out-of-scope

Explicitly deferred from 3.1.6:

- **D5 — `triggerSource` literal-union typing.** Complementary housekeeping commit. Land before mech.1 if convenient (so mech.1 uses the new type) or after the close.
- **Worker idle-tick heartbeat log.** Thread 2.5 surfaced that the worker silence created an "is it alive?" ambiguity. Not blocking. Can land as a 1-line `log.info("cron tick evaluated", ...)` whenever the worker observability appetite returns. Not 3.1.6 work.
- **Including ProductTag rows in `knowledgeContentHash`** (the alternative way to fix Finding 1). Would simplify the recurring-sync wire but breaks the documented "circular dependency" rationale and forces a one-time hash bump on every product (every embedding becomes stale-by-definition). Not worth it now; the post-tag chain (D1 ii) is the cheaper fix.
- **`worker-reembed.ts` reading APPROVED-only tags vs all-tags semantics for Stage 1 retrieval**. Mech.1 includes a one-line `where: { status: 'APPROVED' }` fix to align the embedding inputs with retrieval. Whether *all* of the retrieval code paths agree on APPROVED-only is a Stage-1 audit, separately tracked under op debt #9 (uncurated `expectedHandles`) and op debt #10 (PR-2.2 calibration coverage).
- **Webhook subscription state verification (Thread 1 step B).** Still blocked by the expired offline session token. Not 3.1.6 work; Thread 1 surfaced it as a fresh-token-needed task.
- **Today's cron tick observation.** The 5/8 07:00 UTC tick will fire ~1h after Thread 2.5 captured state. Worth eyeballing the next CatalogSyncJob row when re-running the catalog-sync history script, but no action item for 3.1.6.

---

## Surfacing — items that affect or contradict the prompt's option premises

1. **Finding 1 is the headline.** The prompt's three options all assume Decision A's skip predicate is sound. It isn't. The post-tag-completion enqueue path (D1 ii) is doing work the predicate can't do. This shifts what "Option C" means — it's now "completion-driven enqueue + scanner backstop" rather than "DELTA-call-site enqueue + scanner backstop".
2. **Option A's "misses metaobject NULL fan-out" is more important than it sounds.** That fan-out fires on every metaobject definition update, which on a real shop is rare but high-leverage (one metaobject can be referenced by dozens of products). A 3.1.6 that doesn't catch this leaves a known production gap that's already producing NULL hashes.
3. **The Decision A predicate is a safety net, not a trigger.** This is true under any of A/B/C with D1 ii. The recurring-sync wire does the triggering; the predicate exists so that re-running RE_EMBED on an already-fresh embedding is cheap. Reframing this in the mech.1 prompt clarifies why the wire is needed even though "the handler already has a skip path".
4. **No new fourth option emerged from the read.** The "completion-driven + scanner" variant is a sharpening of C, not a new option.
