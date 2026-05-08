# Sub-bundle 3.1.6 — Recurring sync: automatic RE_EMBED enqueue wire

**Status:** PLANNING (architecture locked, mechs not yet implementing).
**Investigation threads:** 1, 2, 2.5, 3 — four read-only threads complete, all artifacts in `.pr-3-1-6-planning-artifacts/`.
**Prior context:** Sub-bundle 3.1 closed at `8bf9da8`; Sub-bundle 3.1.5 closed at `3cdf212`.
**Closes on:** the recurring-sync gap recorded as op debt items #18, #20, #21 in HANDOFF.md.

---

## Section 1 — Problem statement

The recurring-sync gap as understood after four threads of investigation:

The DELTA chain works. Cron tick fires daily at the dev shop's local 03:00 ET (07:00 UTC) and webhook deliveries enqueue CatalogSyncJob DELTA rows. Worker-phase-products paginates the delta window, upserts each product, and detects content drift via `hashChanged` from `upsertProductKnowledge`.

The AI-tagging chain works. On a hashChanged DELTA, worker-phase-products enqueues a `SINGLE_PRODUCT` TaggingJob with `triggerSource="DELTA_HASH_CHANGE"`. The worker-tagging handler claims it, calls Anthropic, writes ProductTag rows.

**The embedding-refresh chain does not exist as automatic.** No production code path enqueues RE_EMBED. The handler (worker-reembed.ts, mech.6) and the helper-via-script (`scripts/bulk-reembed-products.ts`, 3.1.5) both exist, but nothing wires them to a recurring trigger. Embeddings are only refreshed when a human runs the bulk script.

Empirical proof: `elite-linen-styling-service` was edited via webhook on 2026-05-03 at 09:34 UTC. The webhook → DELTA → hashChanged chain ran cleanly: a SINGLE_PRODUCT TaggingJob completed in 3.4s, rewriting 13 + 1 tags. But no RE_EMBED enqueued. The product's `embeddingContentHash` stayed NULL until the 3.1.5 bulk pass on 2026-05-08T04:28 UTC finally caught it. **Five days of stale embedding for a real production-edited product.**

The deeper finding (Thread 3, surfacing the architectural reason): the embedding text **includes ProductTag rows** (`product-embedding.server.ts:57-62`); the `knowledgeContentHash` **deliberately excludes them** (`knowledge-hash.server.ts:13-17`: "Phase 2 generates those *from* the knowledge record; circular dependency"). The skip predicate

```ts
embeddingContentHash !== null && embeddingContentHash === knowledgeContentHash
```

is therefore a **safety net against unnecessary re-embeds**, not a sufficient trigger for them. A SINGLE_PRODUCT job can rewrite ProductTag rows without changing `knowledgeContentHash`, leaving the embedding stale while the predicate cheerfully says "skip". Recurring sync requires an explicit enqueue path; the predicate alone cannot close the gap.

---

## Section 2 — Architectural decision

### Locked: Option C, modified

- **Inline trigger:** `worker-tagging.ts` SINGLE_PRODUCT handler enqueues a follow-up RE_EMBED on the SUCCEEDED transition for the same productId.
- **Backstop scanner:** a NULL-knowledgeContentHash sweep runs on cron tick, fanning out RE_EMBED for products that landed in stale state via paths other than AI-tagging completion (notably `bumpHashForMetaobjectReferents` which writes NULL hashes on metaobject definition updates, with no current consumer).

### Why this and not the prompt's literal Option A or B

- **Option A (inline at the DELTA call site)** misses two things: (a) the metaobject NULL fan-out path entirely, and (b) the AI-tag-drift gap surfaced by Thread 3 Finding 1 — re-embed enqueued at DELTA time may run BEFORE the AI-tag job rewrites ProductTag rows, embedding stale-tag state, with no later trigger to re-embed against fresh tags.
- **Option B (scanner only)** is functionally complete but loses the tight per-event coupling. A merchant edit would wait up to 24h for the next cron tick to refresh the embedding. Acceptable for the metaobject case (rare, low-stakes) but feels wrong for the products-update case (frequent, recommendation-impacting).
- **Option C-modified** triggers near-real-time on the events that matter (any AI-tag completion, including DELTA-driven, manual retag, future cron-driven retag) and keeps a defensive sweep for everything else.

The "modified" detail: the inline half hooks at handler **completion**, not at the DELTA call site. This places the enqueue chronologically *after* the AI-tag write, so the embedding text always sees fresh tags — solving Finding 1's race. Rejected variant (D1 option (i) "independent"): two parallel enqueues with no formal ordering, embedding text potentially built against stale tags.

### Trade-offs accepted

- **One-way coupling** between worker-tagging.ts and worker-reembed.ts. Tagging knows about embed; embed doesn't know about tagging. Comment-discipline keeps the dependency direction documented.
- **Wasted enqueue cost** on every SINGLE_PRODUCT completion (Decision A short-circuits if knowledge unchanged AND tag set unchanged-from-stored-hash-input). At dev-shop scale: negligible. At hypothetical 100k-product full-retag scale: ~17 minutes of single-claim worker time spent claim-and-skipping. Acceptable.
- **Two enqueue paths instead of one.** Both are simple; the scanner is the safety net.

---

## Section 3 — Mech-commit shape

### PR-3.1.6-mech.1 — load-bearing wire (~250 LOC, 4-5 new tests)

- New helper `enqueueReembedForProduct({ shopDomain, productId })` in `app/lib/catalog/enqueue-tagging.server.ts`, mirroring `enqueueTaggingForProduct` shape but with `kind: "RE_EMBED"`.
- `worker-tagging.ts` SINGLE_PRODUCT handler: on SUCCEEDED transition, call `enqueueReembedForProduct`. Implementation lock: inline call inside the handler post-status-update, **before tx commit if possible; otherwise inside same tx**. The exact code-shape decision (in-tx vs. post-tx) lands at mech.1 prompt time.
- `worker-reembed.ts` handler: add `where: { status: "APPROVED" }` to the ProductTag query (Finding 2 fix — aligns embedding inputs with Stage 1 retrieval requirements).
- `worker-reembed.ts` handler: defensive status check at claim time (op debt #21 fold-in). New skip reason `"status_changed"` when product flipped to non-ACTIVE / deleted / excluded between enqueue and claim.
- `CatalogSyncJob.summary` additive forensics shape (D4 from analysis): `embeddingsEnqueued`, `embeddingsAlreadyQueued`, `embeddingsSkippedNotEligible` keys added to the DELTA summary. Json column — no migration.

### PR-3.1.6-mech.2 — NULL-hash scanner (~150 LOC, 3 new tests)

- New module `app/server/worker-null-hash-sweep.server.ts` (or adjacent location TBD at mech.2 prompt time). Pure function: returns array of productIds that need RE_EMBED based on `knowledgeContentHash IS NULL OR (embeddingContentHash IS NULL AND status='ACTIVE' AND deletedAt IS NULL AND recommendationExcluded=false)`.
- Integration point: `cron-tick.server.ts` runs the scanner per shop after the existing DELTA enqueue. Each scanner result fans out a RE_EMBED enqueue with new `triggerSource="NULL_HASH_SWEEP"`.
- Bounded LIMIT on the scanner query (configurable cap with env override, e.g. 500/sweep) to defend against runaway enqueues during a corruption event.
- Open at mech.2 prompt time: whether the scanner runs every cron tick (every 60s) or only when the existing daily window fires (1×/day). Recommend the latter — quieter and matches the cron tick's "scheduled work" mental model.

### PR-3.1.6-mech.3 — un-exclude trigger (~30 LOC, 1 new test)

- In `webhooks.products.update.tsx`, fetch prior `recommendationExcluded` from local Product row, compare against payload's value, enqueue RE_EMBED on `true → false` transition.
- New `triggerSource="UN_EXCLUDE"`.
- Folds in op debt #20.

### PR-3.1.6 close — verification + bulk re-embed + HANDOFF

- Trigger a real DELTA on the dev shop (manually edit a product in Shopify Admin), watch the chain fire end-to-end. Confirm: webhook → DELTA → hashChanged → SINGLE_PRODUCT enqueue → AI tagging → RE_EMBED enqueue → embedding refresh.
- **Re-run 3.1.5 bulk pass** to refresh all 1,169 ACTIVE product embeddings under mech.1's new APPROVED-only tag semantics (op debt #26). See deferred-decisions §5 for the complication this raises.
- HANDOFF amendment with op debt items #22-#26 and 3.1.6 close subsection.
- Artifacts capture proof of all the above.

**Total: 3 mechs + close.** Smaller than 3.1's 6-mech split because scope is narrower.

---

## Section 4 — Implementation details locked at planning time

| Decision | Locked answer | Source |
|---|---|---|
| **Architecture** | Option C-modified (completion-driven inline + NULL-hash scanner backstop) | Thread 3 §3 |
| **D1 ordering** | Chained — SINGLE_PRODUCT completion enqueues RE_EMBED. Inline call inside worker-tagging handler post-SUCCEEDED transition. | Thread 3 §4 |
| **D2 handler defensive check** | Folded into mech.1 (op debt #21 closes here) | Thread 3 §4 |
| **D3 un-exclude trigger** | Separate mech.3 (op debt #20 closes there) | Thread 3 §4 |
| **D4 summary forensics** | Folded into mech.1 (additive Json shape) | Thread 3 §4 |
| **D5 triggerSource literal-union typing** | Split — separate housekeeping commit, before or after 3.1.6 | Thread 3 §4 |
| **APPROVED-only tag filter in worker-reembed.ts** | Folded into mech.1 (Finding 2 fix) | Thread 3 §1 |

---

## Section 5 — Implementation details deferred to mech-prompt time

These are decisions that are too small for the planning round to lock but big enough to call out so the mech prompts don't drift:

1. **Whether `enqueueReembedForProduct` uses the same fast-path-dedup-then-INSERT-with-uniqueness-defense pattern as `enqueueTaggingForProduct`, or relies purely on the partial unique index `(shopDomain, productId) WHERE status='QUEUED'`.** The existing helper is the cleaner pattern but adds ~30 LOC. Mech.1 prompt picks.
2. **Exact log event names and JSON shapes** for the new enqueue + handler paths. Established convention is `event: "<noun>_<verb>"` (e.g. `event: "reembed_enqueued_post_tag"`). Mech.1 prompt enumerates.
3. **Test coverage approach for chained handler-completion enqueue.** `vi.hoisted` mock pattern likely; tests should cover: (a) success path enqueues, (b) failure path doesn't break the SINGLE_PRODUCT job, (c) Decision-A skip on the follow-up RE_EMBED is observable in summary.
4. **NULL-hash scanner cron cadence** — every-60s vs 1×/day. Recommend daily; mech.2 prompt locks.
5. **Bulk re-embed strategy at 3.1.6 close — the Section 5 complication** (THIS IS THE ONE WORTH FLAGGING):

   Mech.1 changes the embedding text input set by adding `where: { status: 'APPROVED' }` to the tags query. All 1,169 currently-ACTIVE products have `embeddingContentHash === knowledgeContentHash` (post-3.1.5 alignment). Under Decision A, a naive bulk re-pass will **skip every one of them** because the predicate doesn't know that the embedding text generation logic changed.

   Three resolution paths, to be picked at mech.1 or close-prompt time:

   - **(α) Pre-pass NULL-bump.** A one-shot SQL UPDATE that NULLs `embeddingContentHash` on every ACTIVE row pre-bulk-pass. Simplest, surgical. Idempotent. Forces real re-embeds on all 1,169 rows (~$0.027 again per the 3.1.5 cost actual).
   - **(β) Force-re-embed flag.** Add a `force?: boolean` parameter to the RE_EMBED handler that bypasses Decision A. Use it from the bulk script. More flexible long-term but adds API surface.
   - **(γ) Hash bump-via-version.** Add an embedding-text-version constant; include it in `embeddingContentHash` computation. Then any version change automatically invalidates. Most architecturally correct but biggest change.

   Recommend (α) for 3.1.6 close — surgical, one-time, doesn't bloat the handler API. Mech.1 lands the code change; close lands the bulk re-pass with a pre-NULL-bump step.

---

## Section 6 — Out-of-scope (deferred)

Explicitly NOT in 3.1.6:

- **D5 triggerSource literal-union typing.** Complementary housekeeping commit. Land before mech.1 if convenient or after the close.
- **Worker idle-tick heartbeat log** (op debt #24). Cheap observability win; deferred until appetite returns.
- **Including ProductTag in `knowledgeContentHash`** (alternative resolution to Finding 1). Rejected — breaks the documented "circular dependency" rationale and would force a one-time hash bump on every product at the schema level.
- **Stage 1 retrieval audit for APPROVED-only consistency** across all retrieval code paths (op debts #9, #10).
- **Webhook subscription state verification** (Thread 1 step B). Blocked on fresh dev-shop offline session token (see op debt #25).
- **API version mismatch** between `shopify.app.toml` (`api_version = "2026-07"`) and `app/shopify.server.ts` (`ApiVersion.October25`). Pre-existing, surfaced by Thread 1, not 3.1.6 work.

---

## Section 7 — Op debt items added during this planning round

Append items #22 through #26 verbatim to the existing flat numbered list in HANDOFF.md (do NOT renumber the existing 1-21).

```
22. Decision-A skip predicate is a SAFETY NET, not a sufficient TRIGGER.
    The predicate `embeddingContentHash IS NOT NULL AND === knowledgeContentHash`
    cannot detect tag-only drift because embedding text includes ProductTag
    rows but knowledgeContentHash deliberately excludes them
    (knowledge-hash.server.ts:13-17 — circular dependency with Phase 2 AI
    tagging). Recurring sync requires an explicit enqueue path. Mech prompts
    and code comments must consistently frame the predicate as a safety net
    against unnecessary re-embeds, not as the primary correctness mechanism
    that closes the recurring-sync gap.
23. Time-anchor methodology for scheduled-job investigations. Thread 2
    declared "today's cron tick has failed" based on inferred current UTC;
    Thread 2.5 corrected the inference (current UTC was ~05:58, not ~10:30,
    so the 07:00 UTC cron window was still ~1h in the future). Before
    declaring a missed scheduled-job firing in any future investigation,
    anchor wall-clock time from a reliable external source — HTTP probe
    response timestamp, NTP, `Date.now()` printed by a script run on the
    same machine — not from session-relative inference.
24. Worker idle observability gap. The worker only emits log lines on
    enqueue events, error paths, or job claim/finish. Idle ticks are silent.
    This creates an "is it alive?" ambiguity for any human reviewer:
    silence is consistent with both healthy-and-idle and dead-but-marked-
    online. Cheap fix: emit `log.info("cron tick evaluated", {
    evaluatedShops, skippedOutOfWindow, skippedAlreadyEnqueued })` once per
    hour at INFO. Deferred until observability appetite returns. Not 3.1.6
    work.
25. Local-dev offline session token expiry runbook. With
    `expiringOfflineAccessTokens: true` set in app/shopify.server.ts, the
    dev shop's offline token expires every ~24h. Any local-dev script that
    hits Shopify Admin API will get HTTP 401 if no one has opened the
    embedded admin recently (Thread 1 step B blocked here). Resolution
    paths: (a) open the embedded app at
    https://web-production-3b1d7.up.railway.app once to trigger
    token-exchange refresh, OR (b) add SHOPIFY_API_KEY +
    SHOPIFY_API_SECRET to local .env so `unauthenticated.admin(shop)`
    works without the per-shop accessToken path, OR (c) run the script
    on Railway. Worth documenting in CLAUDE.md or a runbook before the
    next investigation that needs live Shopify state.
26. Post-mech.1 bulk re-embed required, with a Decision-A invalidation
    step. Mech.1's APPROVED-only tag filter changes embedding text inputs.
    All 1,169 ACTIVE embeddings have `embeddingContentHash ===
    knowledgeContentHash` (post-3.1.5 alignment), so a naive bulk re-pass
    will see Decision-A skip every row even though the embedding text
    under new semantics differs. Resolution at 3.1.6 close: a one-shot
    SQL UPDATE NULLing `embeddingContentHash` on every currently-ACTIVE
    not-deleted not-excluded row before invoking the existing
    `scripts/bulk-reembed-products.ts`. Cost projection: ~$0.027 USD,
    ~3-5min drain (mirrors 3.1.5 cost/duration actuals).
```

---

## Section 8 — References

- Investigation artifacts (this planning round, `.pr-3-1-6-planning-artifacts/`):
  - `01-webhook-source-declarations.txt` — toml + handler topology
  - `02-webhook-live-subscriptions.txt` — blocked on token expiry; surfaces blocking finding
  - `03-webhook-railway-logs.txt` — 24h log retrospective showing zero webhook activity
  - `04-delta-chain-source.txt` — cron tick + enqueueDeltaForShop full source
  - `05-worker-phase-products-source.txt` — DELTA detection logic + hashChanged handling
  - `06-catalog-sync-history.txt` — 7-day CatalogSyncJob breakdown showing healthy cron tick
  - `07-delta-tagging-jobs.txt` — the elite-linen-styling-service incident in DB form
  - `08-worker-status.txt` — Railway service list snapshot
  - `09-worker-recent-activity.txt` — silent-but-alive worker confirmation
  - `10-worker-errors.txt` — zero-error confirmation in 6h window
  - `11-cron-tick-state.txt` — cron tick state at corrected current UTC, confirms no failure
  - `12-relevant-code-surfaces.txt` — Thread 3 step A code surfaces
  - `13-architectural-analysis.md` — Thread 3's three-option evaluation + recommendation
- Empirical proof point: `elite-linen-styling-service` 5/3 incident, captured in `07-delta-tagging-jobs.txt`
- Prior planning artifacts: none. This is the first formal planning document in `docs/planning/`. Prior closure-evidence artifacts under `.pr-3-1-mech-*-artifacts/` and `.pr-3-1-5-artifacts/`.
- Prior closure commits: `8bf9da8` (Sub-bundle 3.1 close), `3cdf212` (Sub-bundle 3.1.5 close).
- Anchor source files referenced throughout:
  - `app/server/worker-phase-products.ts` — DELTA enqueue site
  - `app/server/worker-tagging.ts` — SINGLE_PRODUCT handler (mech.1 hooks here)
  - `app/server/worker-reembed.ts` — RE_EMBED handler (mech.1 modifies here)
  - `app/lib/catalog/enqueue-tagging.server.ts` — existing helper, mech.1 adds `enqueueReembedForProduct` sibling
  - `app/lib/catalog/knowledge-upsert.server.ts` — `bumpHashForMetaobjectReferents` is the NULL-hash signal source
  - `app/lib/catalog/knowledge-hash.server.ts` — the circular-dependency comment that defines Finding 1
  - `app/lib/embeddings/product-embedding.server.ts` — embedding text construction (the file Finding 1 is rooted in)
