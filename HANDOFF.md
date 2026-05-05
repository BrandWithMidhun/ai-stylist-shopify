# HANDOFF — AI Stylist Shopify App

**Last updated:** 2026-05-05, after PR-3.1-mech.1 (schema migration + eval harness scaffolding + 12 fixture stubs). **Phase 1 CLOSED. Phase 2 CLOSED. Phase 3 IN PROGRESS — sub-bundle 3.1 mech.1 of 6 mech commits shipped; mech.2 (HARD_FILTER_AXES + Stage 1) is next.**
**Supersedes:** Previous HANDOFF.
**North star:** `docs/recommendation-engine-brief.md` v0.3 (commit `22e849c`).
**Scope:** `docs/scope-decisions.md` (commit `616fe70`).
**UI source of truth:** `docs/ui-design-stylemate-v1.pdf` (commit `616fe70`).
**Execution rules:** `docs/claude-execution-rules.md` (commit `9ecd0ad`).

---

## Operating mode

**Continuous execution until the user says stop.**

Default behavior:
- After every PR ships and verifies, immediately plan the next PR
- After every phase closes, immediately open the next phase
- No calendar, no week numbers, no per-phase sizing
- No "should I continue" pauses
- The user stops execution by typing "stop" — at which point the current PR finishes its commit/push/verify cycle and the session ends. No new PR begins.
- The user resumes by saying "resume" or naming the next phase/PR. Picks up exactly where the chain left off.

What this means for me (Claude in this chat):
- Plan-then-execute cycle stays. It's not slower — it's what kept PR-A clean. But the cycles chain back-to-back without my asking permission to start the next one.
- Architectural forks (the rare ones — pricing model, schema decisions, etc.) still get surfaced, but framed as "decision needed, here's my call, push back if wrong" rather than "what would you like?"
- I write planning prompts and execution prompts as artifacts, you paste to Claude Code, Claude Code returns results, I review, next prompt.

What this means for Claude Code:
- Operates per `docs/claude-execution-rules.md` — fully autonomous, no interruptions, batch execution, single-shot completion within the scope of one PR.
- Returns the plan to me, then the execution result. Doesn't ask the user mid-task.

What this does NOT mean:
- I don't skip the brief or HANDOFF reads on fresh sessions. Fresh-me always loads context first.
- Claude Code doesn't combine multiple PRs into one execution. PR boundaries are real — they correspond to deploy + verify cycles.
- The user always retains full stop authority, no matter how deep into a chain we are.

---

## Where we are

**Production:** **Phase 1 CLOSED. Phase 2 PR-2.1 + PR-2.2 SHIPPED.** Phase 1's five PRs (A, B, C, C.5, D) and Phase 2's PR-2.1 (`dc5b050` + `ca4d4cd` + close at `6cd82ce`) and PR-2.2 (`a7c196a` + `a0a640f` + `a1ae025` + `35ca74e` + `86fe3b9`) all live and verified. All 18 webhook subscriptions live; products/{create,update} thin (worker is sole authoritative writer for the full Product column set on the DELTA path); collections stale-write-checked + DELTA enqueue; inventory direct narrow upsert; customers/* now write `CustomerProfile` rows in real time; orders/* still log-only stubs awaiting Phase 3 ingest. In-worker daily cron tick fires at 03:00 in merchant timezone. **Tagging engine end-to-end (PR-2.1 + PR-2.2):** INITIAL_BACKFILL handler with cursor-resume + mid-run budget gate is live in the worker; FASHION vocabulary expanded from 11 to 16 axes via two evidence-driven extensions (sustainability + season at PR-2.2-mech.1; sleeve_length + pattern + collar_type at PR-2.2-mech.4); rule-engine re-tag bug fixed (PR-2.2-mech.2); reporter converted to TypeScript with imports from canonical vocabulary source (PR-2.2-mech.3); cost-per-Kc anchor recalibrated $0.0011 → $0.0032 from n=50 actual data (PR-2.2-mech.4). Tagging engine ready for the merchant-facing review surface in the Phase 4 portal scaffold (where the review UI lands alongside Dashboard Overview, Customer Profile, AI Agents config, and the rest of the substantive merchant-facing dashboard). PR-2.3 closes Phase 2 with a re-scoping commit; the review UI does NOT ship in the embed app. PR-2.3 (this commit) is the re-scoping commit — HANDOFF amendment recording the surface architecture correction. No code shipped. Phase 2 acceptance is met by PR-2.1 (tagging engine entry) + PR-2.2 (first-pass tagging + vocabulary calibration verified n=50 against ai-fashion-store.myshopify.com) + this PR-2.3 closure record. Tagging review UI lands in Phase 4 portal scaffold (sub-bundle 4.3 alongside Customer Profile + AI Agents config) per HANDOFF Phase 4 scope.

**Local:** All work pushed through PR-2.2-mech.4 (`86fe3b9`). Branch synced with origin/main. PR-2.2 close commit captures the n=50 take-4 reporter artifacts in git and updates this HANDOFF.

**Sync button:** Functional. Clicking queues a `CatalogSyncJob` row; the worker drains it within ~5s. MANUAL_RESYNC kind cancels any in-flight DELTA job for the shop before claiming.

**Migration discipline locked:** Production Railway Postgres is the only database. Claude Code never runs `prisma migrate dev`. Migration files are authored via `prisma migrate diff` (read-only inspection) and hand-written SQL. Migrations apply only on Railway deploy via `prisma migrate deploy`. See CLAUDE.md "Operational notes" for the full rule.

---

## Plan shape

**13 phases.** Plan-then-execute per phase, chained continuously. Bundle within phases where mechanical and topically tight. Don't combine across architectural seams.

**Phase 1 is split across 4 PRs (A through D).** PR-A shipped. PR-B, PR-C, PR-D pending. Phases 2 through 13 are larger but each is one plan-execute cycle for the planning round, with internally bundled work executed across 1-3 PRs as the plan dictates.

**No timeline.** Phases close when their acceptance criteria are met. Milestone gates trigger when their prerequisite phases close. Velocity emerges from execution, not from planning.

**Compression cut-list, ordered by lowest-cost-first if scope pressure ever hits:**
1. Defer Phase 8 (Knowledge Base) — ship post-launch
2. Defer Phase 9 (Size & Fit + Color Logic) entirely
3. Cut Phase 12 UI Pass 2 to merchant-facing only (storefront stays at v0)
4. Drop 2 of 4 launch integrations
5. Cut Quiz Builder UI to JSON-config v1

Below cut #5 the plan is unrealistic without cutting features themselves.

---

## Milestone gates

| Gate | Triggered when | What this means |
|---|---|---|
| First soft-launch | Phase 5 closes | Chat + conversations + analytics dashboard usable by a real merchant. Onboard one paying merchant here for real feedback. |
| Differentiator activates | Phase 7 closes | Lookbook live. Word-of-mouth starts. |
| Pricing flips on | Phase 10 closes | Tier names + dollar amounts + caps decided. Stripe/Shopify Billing live. Soft-launch merchants migrate to paid. |
| Launch-ready | Phase 11 closes | All 4 launch integrations live. Public App Store submission. |
| App Store approved | Phase 13 closes + Shopify review passes | Public launch. |

---

## Phase 1 — Knowledge ingestion foundation ✓ CLOSED

**State:** All five PRs shipped — PR-A, PR-B, PR-C, PR-C.5, PR-D. Phase closed 2026-05-03.

**Goal:** Catalog ingestion fully autonomous. Worker drains queued jobs, webhooks trigger DELTA jobs on every relevant change, daily cron catches missed webhooks, all 1,169 dev-store products land in the new richer knowledge record with content hashing in place. **Met.**

### PR-B — Worker service + first INITIAL backfill ✓ SHIPPED

**Scope:**
- New worker entry point (`app/server/worker.ts`)
- Railway second-service config (same Docker image, different CMD, no HTTP port)
- Claim loop: poll `CatalogSyncJob` for QUEUED, claim via `FOR UPDATE SKIP LOCKED`, process through phase state machine
- Phase state machine: COLLECTIONS → METAOBJECTS → PRODUCTS → FINALIZE for INITIAL/MANUAL_RESYNC; same with `updated_at:>=` filter for DELTA
- Per-batch: page size 50 (drop to 25 if cost is high), throttle integration (`extractThrottle`, sleep when `currentlyAvailable < 200`), per-product upsert, cursor write at every batch boundary, heartbeat at start of every batch
- Stuck-job sweep on worker boot (calls `sweepStuckJobs` from PR-A library, resets RUNNING-with-stale-heartbeat to QUEUED, resumes from cursor — does NOT mark FAILED)
- DELTA cancellation when MANUAL_RESYNC starts (PR-A library function `cancelDeltaJobsForShop`)
- Graceful shutdown (SIGTERM finishes current batch, commits cursor, exits clean)
- Health check / liveness signal
- First INITIAL run against dev store — verify all 1,169 products have non-null `knowledgeContentHash` and populated `lastKnowledgeSyncAt` after completion

**Out of scope:** Webhook subscription changes (PR-C). Cron (PR-D). Bulk Operations API (deferred). Re-embedding products against the new richer record (Phase 3).

**Inputs needed:** None — PR-A laid all foundations. Library functions exist, schema exists, GraphQL queries exist, throttle exists.

**Bundling:** Solo PR. No internal bundling — this is a thin orchestration layer, but every component (claim loop, phase machine, Railway config, first backfill) needs careful sequencing.

**Acceptance:**
- Worker boots in production on a separate Railway service
- Web service health-check passes throughout worker activity
- INITIAL job completes for dev store: 1,169 products processed, ~0 failures (any per-product failures land in `CatalogSyncJobFailure` with diagnostics)
- Manually killing the worker mid-job → restart → resume from cursor verified
- Heartbeat timeout test: kill worker without graceful shutdown → after timeout, next worker boot picks up the stuck row and resumes

**Shipped:** Three commits — 11507a8 (worker entrypoint + claim loop + phase machine + releaseJobToQueue), f6ffcbe (Railway worker service config + Dockerfile dispatch + ops runbook), 2011028 (enqueue-initial + verify-initial-run scripts; pulled forward PR-C scope additions; first INITIAL backfill verified).

**Verification:**
- INITIAL backfill: 2,632 / 2,632 products processed, 0 failures, 1m 46s duration, 5,084 Shopify cost units.
- Verifier: 7 PASS / 0 FAIL / 2 SKIP. Two SKIPs (metaobject linkages, multi-collection products) — vacuous given dev shop catalog.
- Stuck-job recovery test: synthetic stale-heartbeat approach, sweepStuckJobs picked up the row, resumed from cursor, completed SUCCEEDED.
- Graceful shutdown test: passed 5 times. SIGTERM → ABORTED → releaseJobToQueue → resume cycle confirmed.

**Scope pulled forward into PR-B:** Eight Shopify scopes deployed — read_products, write_products, read_inventory, read_metaobjects, read_metaobject_definitions, read_customers, write_customers, read_orders. Originally PR-C scope; pulled forward to satisfy PR-B's METAOBJECTS phase. Dev shop re-authorized. PR-C's scope work reduced to re-auth UX banner only (for production installs that pre-date the expanded scopes).

### PR-C — Webhook subscriptions + handlers + re-auth banner ✓ SHIPPED

**Shipped:** Four commits — `9475119` (subscriptions + skeleton handlers + enqueue-delta stub + cursor-at migration), `8247140` (handler logic + dedup + stale-write checks; Addition 3 verified pre-push, Addition 2 surfaced regression post-deploy), `8447d86` (legacy `upsertNormalizedProduct` restored alongside DELTA enqueue — regression fix), `6a3deff` (re-auth banner + cursor age probe + needsReauth + 8 unit tests).

**Verification:**
- Addition 1 (subscription registration): 18 topics confirmed via `shopify app deploy` + Shopify Admin API `webhookSubscriptions` query, plus end-to-end product-edit test on `100-pure-linen-fabric-gift-box`.
- Addition 2 (end-to-end webhook → DELTA → hash change): PASS on C.2.1 retry. Pre-edit hash `f8206f23…85564d821` → post-edit `a4064287…1e45efd2`; title + shopifyUpdatedAt + syncedAt + lastKnowledgeSyncAt + knowledgeContentHash all advanced/changed correctly. DELTA `cmolq8yxy000bqh36r65pdkpi`: 810ms drain, `processedProducts=1`, `driftCount=1`. The C.2 first-attempt failure is what surfaced the missing legacy-write path (worker `upsertProductKnowledge` writes only knowledge-record fields; replacing the legacy upsert in webhooks left no writer for `title`/`productType`/`vendor`/`shopifyTags`/`featuredImageUrl`/`imageUrls`/`priceMin/Max`/`currency`/`totalInventory`/`inventoryStatus`/variants). PR-C.5 closed this structurally — see below.
- Addition 3 (dedup burst): PASS — 5 sequential `enqueueDeltaForShop` calls → 1 fresh + 4 deduped, single jobId, drained by production worker in 1.3s.
- Q5 (re-auth banner): PASS programmatically (8/8 tests including `write_X ⇒ read_X` implication contract); negative-direction visual confirmation post-deploy (no banner renders on `/app` load with current dev shop scopes).

**Dedup design — QUEUED-only is correct, not merely acceptable.** `enqueueDeltaForShop` dedups against `status='QUEUED'` rows only; not RUNNING. Promoting to QUEUED+RUNNING would introduce a correctness gap: mid-fetch edits where the running DELTA's `updated_at:>=` window has already paginated past a product would be silently missed if a follow-up DELTA-B got deduped against the running DELTA-A. The current scope guarantees every edit window opens at least one DELTA fetch.

**Cursor age observability.** `saveCursor` now writes the matching `*CursorAt` column atomically with the cursor; PRODUCTS + COLLECTIONS phase loops log `cursorAgeMs` per batch. No real values during PR-C operation — DELTA path uses `updated_at:>=` filter, not saved cursors. First values surface on the next MANUAL_RESYNC, INITIAL run, or stuck-job resume (or when PR-D's cron exercises it). PR-B's "cursor TTL anomaly to investigate" status moves to "monitoring — instrumentation in place".

### PR-C.5 — Two-writer collapse ✓ SHIPPED

**Shipped:** One commit — `1eda3c2` (collapse two-writer pattern; worker becomes single authoritative writer for products).

**Pattern picked.** Extend `upsertProductKnowledge` to write the full Product column set (legacy + knowledge fields). The sibling-function alternative was rejected — it added an indirection without simplifying the call site. Single function, single call from the worker, hash inputs read from freshly-fetched `knowledge.*` (not the existing-row column values that had been masking title/tag changes in the C.2 first-attempt regression).

**Files modified (5 files, +366 / -195):**
- `app/lib/catalog/queries/knowledge.server.ts` — `PRODUCT_KNOWLEDGE_PAGE_QUERY` and `PRODUCT_KNOWLEDGE_BY_ID_QUERY` expanded with `featuredImage`, `images(first:20)`, `priceRangeV2`, `totalInventory`, `createdAt`, `variants(first:100)`. Type `GqlKnowledgeProduct` expanded; `GqlKnowledgeProductMoney`/`GqlKnowledgeProductVariant` added.
- `app/lib/catalog/knowledge-fetch.server.ts` — `NormalizedProductKnowledge` expanded with `handle`, `title`, `productType`, `vendor`, `status`, `shopifyTags`, `featuredImageUrl`, `imageUrls`, `priceMin/Max`, `currency`, `totalInventory`, `shopifyCreatedAt`, `variants`. `NormalizedKnowledgeVariant` added. `normalizeKnowledgeProduct` populates all new fields.
- `app/lib/catalog/knowledge-upsert.server.ts` — `upsertProductKnowledge` rewritten end-to-end. Order: existing-row probe → stale-write check → resolve collection/metaobject GIDs → compute hash from fresh `knowledge.*` → single `tx.product.upsert` with all legacy + knowledge columns including `knowledgeContentHash`/`knowledgeContentHashAt`/`lastKnowledgeSyncAt` → reconcile metafields → reconcile collections → reconcile variants (deleteMany + per-variant upsert mirroring `upsert.server.ts:262-307`). Imports `deriveInventoryStatus` from `upsert.server`.
- `app/routes/webhooks.products.create.tsx` — thinned. Drops `normalizeFromWebhook`, `upsertNormalizedProduct`, `WebhookProductPayload` imports; drops the legacy upsert try/catch and the `products_legacy_upsert_failed` log. The `products_webhook_dual_write` log is replaced with `products_webhook_enqueued` (drops `legacyUpsertOk`/`deltaEnqueued`; keeps `topic`/`shop`/`webhookId`/`resourceId`/`deduped`/`jobId`/`durationMs`). Stale-write gate unchanged — now gates only the DELTA enqueue.
- `app/routes/webhooks.products.update.tsx` — same thinning as create.

**Files NOT touched.** `webhooks.products.delete.tsx` (soft-delete + DELTA pattern unchanged; different correctness path). Other webhook handlers (no legacy writer to collapse). `prisma/schema.prisma` (zero migrations in PR-C.5). `app/lib/catalog/upsert.server.ts` — `upsertNormalizedProduct` stays defined but unused on the products-webhook DELTA path.

**Verification (artifacts captured in `.pr-c5-artifacts/`, removed pre-commit):**
- Lint: clean. Build: clean (server modules unchanged at 139). Tests: 26/26 pass.
- End-to-end (post-deploy): canonical Addition 2 retry against `100-pure-linen-fabric-gift-box` (title appended `" (test C.5)"`). Pre-edit hash `a4064287…` → post-edit `ca418d64…`. Three timestamps (`syncedAt`, `lastKnowledgeSyncAt`, `knowledgeContentHashAt`) collapsed to a single instant `18:35:14.460`, confirming the consolidated single-writer architecture works.

**Latency contract.** Webhook → DB row update extends from ~150ms (legacy in-handler write) to ~5-30s end-to-end (DELTA enqueue → worker poll 2-5s → GraphQL fetch → upsert in tx). Acceptable per HANDOFF dedup-design rationale; **no stale-state window at any point** — the previous architecture had ~150ms title appearance with a ~5s stale-hash window; the new architecture has ~6.5s end-to-end save → DB but a single coherent write. Downstream consumers should not assume sub-second propagation; if a UI surface needs faster feedback for merchant-edit confirmation, build it on top of the webhook ack (synchronous), not the DB read (asynchronous).

**Authoritative writer for products.** `upsertProductKnowledge` in `app/lib/catalog/knowledge-upsert.server.ts` is the sole writer for the full Product column set on the DELTA path. Future schema additions for product fields (legacy or knowledge) go through this function. `upsertNormalizedProduct` in `app/lib/catalog/upsert.server.ts` is unused on the DELTA path but stays defined; PR-D cron MUST call `upsertProductKnowledge` (not `upsertNormalizedProduct`) to maintain the single-writer architecture.

### PR-D — Daily delta cron + Customer Profile schema + customer/order backfill ✓ SHIPPED

**Shipped:** Three commits — `f104022` (D.1), `3e8d3fb` (D.2), `d718d93` (D.3).

**D.1 (`f104022`) — CustomerProfile schema + customer webhook thickening + GDPR redact helper. SHIPPED.**
- Schema migration: 4 new models (`CustomerProfile`, `CustomerProfileAttribute`, `CustomerSession`, `CustomerEvent`), 1 enum (`CustomerEventKind`), 4 column additions wired into existing models.
- Customer webhook handlers (`customers/{create,update,delete}`) thickened from log-only stubs to real upsert/redact logic against `CustomerProfile`.
- GDPR redact helper centralizes redaction logic, called by both `customers/redact` and `customers/delete`.
- Migration verified post-deploy with the IVFFlat-known-exception gate (see operational debt below).

**D.2 (`3e8d3fb`) — In-worker cron tick + timezone refresh + triggerSource wiring. SHIPPED.**
- Cron implemented as in-worker scheduled trigger (not a separate Railway cron service). Tick loop fires every minute; each shop's `MerchantConfig.timezone` resolved at tick time so timezone changes take effect within one tick.
- `CatalogSyncJob.triggerSource` column distinguishes CRON vs MANUAL_RESYNC vs DELTA enqueue origin.
- Force-tick verification PASSED on 2026-05-01 — both forced (post-boot) and natural (03:00 America/New_York) cron firings observed in production with `triggerSource='CRON'` written to `CatalogSyncJob`. Artifact at `.pr-d-artifacts/d2-force-tick-verify.txt`.

**D.3 (`d718d93`) — Customer + 90-day order backfill script + verifier. SHIPPED.**
- Backfill script: bulk-fetches all customers for a shop, then for each customer fetches orders within a 90-day window, populates `CustomerProfile` + initial `CustomerEvent` rows (`ORDER_PLACED` kind) from order history.
- Verifier asserts `CustomerProfile` count equals Shopify customersCount, `ORDER_PLACED` event count equals Shopify ordersCount in the same window, and at least one profile has at least one event (skipped vacuously when shop has zero orders in window).
- Post-deploy verification on dev shop `ai-fashion-store.myshopify.com` on 2026-05-03 PASSED — 3 customers, 0 orders in 90d window, 2 PASS / 1 SKIP / 0 FAIL, OVERALL PASS. Artifacts at `.pr-d-artifacts/d3-backfill-run.txt` and `.pr-d-artifacts/d3-verify-run.txt`.

**Phase 1 close:** All five PRs landed (A, B, C, C.5, D). Sync system fully autonomous. CustomerProfile schema in place + thick customer webhook + verified backfill. Phase 2 unblocked 2026-05-03.

---

## Phase 2 — Catalog intelligence (AI tagging) ▶ IN PROGRESS

**State:** PR-2.1 shipped + verified 2026-05-03. PR-2.2 shipped + verified 2026-05-04. PR-2.3 closes Phase 2 with a re-scoping commit. The tagging review UI moves to Phase 4 alongside the portal scaffold (Dashboard Overview + Customer Profile + AI Agents config + tagging review as one of its modules). Phase 2's mechanical scope — catalog intelligence (tagging engine, vocabulary, scale verification) — is complete; the merchant-facing review surface belongs in the portal, not in the embed app.

**Goal:** AI-tagging engine generates structured tags (occasion, style, formality, color, fit, material, season, etc.) per product, mode-aware, with merchant review/approval. Tagging admin UI in embed app — functional v0, Polaris.

**Scope:**
- Tagging engine: LLM-orchestrated against product knowledge record (title + description + image URLs + existing metafields). Mode-specific tag schemas (FASHION different from ELECTRONICS).
- Tags stored as structured columns on `Product` (not free-text), so they're filterable in Stage 1 of the pipeline.
- Re-tag triggers: new product, knowledge record change, manual merchant retag.
- Review queue UI in embed app: pending tags, approved tags, rejected tags. Bulk approve/reject. Per-product edit.
- Tagging cost budget (env var, default $0.005/product). Hard cap with merchant warning.
- First-pass tag all 1,169 dev-store products against the new knowledge record.

**Out of scope:** Pipeline integration (Phase 3 — pipeline reads tags as Stage 1 + Stage 3 input). Reviews + blogs ingest (Phase 4). UI Pass 2 polish (Phase 12).

**Embedded admin app starting state:** `/app` currently shows the React Router scaffold from the original Shopify CLI bootstrap (Generate-a-product demo, App template specs box). Phase 2 replaces this surface entirely with the tagging review queue.

**Inputs needed:** UI design from PDF for tagging review surface (embed app). Mode-specific tag schemas — FASHION confirmed; ELECTRONICS/BEAUTY/FURNITURE/GENERAL drafted in this phase.

**Bundling:** Three internal sub-bundles, sequenced.
- 2.1: Tagging engine + storage schema + retag triggers
- 2.2: Mode-specific tag schemas + first-pass tagging of dev store
- 2.3: Tagging review UI in embed app

**Acceptance:**
- All 1,169 dev-store products have tags in the new structured columns
- Tagging cost stays under budget for the dev store
- Merchant can review and approve/reject tags in embed app
- Re-tagging on product edit verified end-to-end (edit product in Shopify → webhook → DELTA → re-tag → review queue surfaces)

### PR-2.1 — Tagging engine entry ✓ SHIPPED

**Shipped:** Two commits — `dc5b050` (mechanical scope), `ca4d4cd` (boot-event observability follow-up).

**`dc5b050` — schema + queue + cost ledger + worker loop + 4 trigger surfaces.**
- Schema migration `20260503130000_add_tagging_review_and_jobs`: `TagReviewStatus` enum, three new ProductTag columns (`status` default `PENDING_REVIEW`, `reviewedAt`, `reviewedBy`), `TaggingJobKind` + `TaggingJobStatus` enums, `TaggingJob` model with 4 standard indexes + 2 partial unique indexes (QUEUED-only dedup, INITIAL_BACKFILL singleton), MerchantConfig budget tripwire columns. One-time backfill `UPDATE "ProductTag" SET status='APPROVED' WHERE source='HUMAN'`. IVFFlat-strip discipline maintained — `DROP INDEX "Product_embedding_cosine_idx"` omitted from migration SQL with header-comment evidence.
- Queue helpers (`tagging-jobs.server.ts`) mirror `sync-jobs.server.ts`: claim-with-FOR-UPDATE-SKIP-LOCKED, heartbeat, sweep, release, cancel-for-product, resume-paused-for-shop. Reuses `KNOWLEDGE_WORKER_HEARTBEAT_TIMEOUT_MS`.
- Cost ledger (`tagging-cost.server.ts`) hardcodes Sonnet 4.6 / 4.5 base rates ($3 / $15 per Mtok, sourced from platform.claude.com 2026-05-03), enforces three env-tunable caps: `TAGGING_COST_PER_PRODUCT_USD_MICROS` (default 5000 = $0.005), `TAGGING_COST_PER_SHOP_DAY_USD_MICROS` (default 500000 = $0.50), `TAGGING_BACKFILL_BUDGET_USD_MICROS` (default 10000000 = $10). Daily tripwire writer flips MerchantConfig timestamps at 80% (warn) / 100% (pause), updates in-flight rows to `BUDGET_PAUSED` at 100%. Daily rollover lazily resets tripwires + resurrects paused rows on first cost record of new UTC day.
- Worker loop (`worker-tagging.ts`) runs in same process as sync claim loop on independent poll interval + independent heartbeat clock. Pre-claim budget check; retry policy: `RATE_LIMIT`/`CONNECTION` exponential-backoff (max 3, 500/1500/4500ms), `MALFORMED_JSON` one stricter-prompt retry, `AUTH`/`OTHER` immediate fail.
- Four trigger surfaces: PRODUCTS_CREATE webhook → `enqueueTaggingForProduct` adjacent to existing DELTA enqueue. Worker DELTA hash-change → enqueue when `upsertProductKnowledge` returns `hashChanged=true`, executed OUTSIDE the upsert transaction. Manual retag at `/api/intelligence/retag/:productId`. Per-tag review at `/api/products/:id/tags/review` writing `status`, `reviewedAt=now()`, `reviewedBy=Shopify staff GID`.
- `ai-tagger.server.ts` bumped to `claude-sonnet-4-6`, accepts `rejectedValuesByAxis` for prompt + post-call exclusion (defense in depth), returns `inputTokens`/`outputTokens`, classifies errors into the 5-class taxonomy, replaces `console.log` with structured `worker-logger`. `rule-engine.server.ts` writes new RULE tags with `status='APPROVED'` (audit action `ADD_RULE`). `tag-status.ts` adds orthogonal `computeTagStatusFull` source × status matrix with three new labels (`ai_approved`, `ai_rejected`, `rejected`); legacy `computeTagStatus` preserved.
- 32 new tests across 3 test files (`tagging-cost.test.ts`, `tagging-jobs.test.ts`, `tag-review-state.test.ts`). 134/134 total passing.

**`ca4d4cd` — unconditional boot event for the tagging loop.**
- Adds a single `log.info("tagging loop starting", { event: "tagging_loop_started", pollIntervalMs: ... })` call at the entry of `startTaggingLoop` in `worker-tagging.ts`, before the async-fire into `runLoop`. Mirrors `worker.ts:48` (`worker boot`) for boot-sequence consistency. Identified as an observability gap during PR-2.1 smoke pre-flight (CHECK 2 of pre-smoke verification): on a clean post-deploy state with zero TaggingJob rows, the loop emitted no log line because the existing `tagging boot sweep complete` log was conditional on stuck jobs.
- Verified post-deploy: `tagging_loop_started` event fired at 2026-05-03T09:49:14.090Z with payload `pollIntervalMs="2000-5000"`.

**Verification:** Smoke S1–S8 PASSED on 2026-05-03 against `ai-fashion-store.myshopify.com`. One FASHION product (`gid://shopify/Product/9132195578113`, "Elite Linen Styling Service (Virtual)"), 6,296-char description, zero pre-existing ProductTag rows. Manual user-edit triggered the chain (programmatic API trigger blocked by stale offline session token — see operational debt below).
- **S3 worker drain:** TaggingJob `cmopkqknp000tjo0odf1m81i9` SUCCEEDED, triggerSource=`DELTA_HASH_CHANGE`, RUNNING window 3415ms, 1249/222 tokens, $0.007077 cost, 13 tags written (1 RULE + 12 AI), model `claude-sonnet-4-6`.
- **V2 gate (axesNeeded non-empty):** PASS — 10 axes left for AI: gender, category, fit, color_family, occasion, style_type, statement_piece, material, size_range, price_tier.
- **S4 V1 vocabulary:** 25.0% gap density (3 out-of-vocab axes / 12 AI tags), under 30% threshold. Three gaps (`delivery_mode=online`, `product_format=virtual_service`, `styling_service=personal_styling`) all from the virtual-service product — edge case for FASHION applied to non-garment inventory.
- **S5 persistence + audit + single-writer:** all 12 new AI rows status=PENDING_REVIEW + non-null confidence, 12 ProductTagAudit rows with action=ADD covering every tag, Product timestamps consistent.
- **S6 migration verification:** 0 AI/APPROVED rows (Risk #3 mitigated — backfill predicate stayed at exactly `source='HUMAN'`); 1 RULE/APPROVED row (the smoke's rule-engine write — confirms `rule-engine.server.ts` change is live); 4 RULE/PENDING_REVIEW rows pre-date PR-2.1 and will lift organically during PR-2.2's first-pass.
- **S7 heartbeat independence:** synthetic-burst test PASSED — TaggingJob heartbeat at `04:06:19.843Z`, CatalogSyncJob heartbeat at `04:06:19.918Z`, both advancing in parallel.
- **S8 IVFFlat preservation:** `Product_embedding_cosine_idx` present in `pg_indexes` post-deploy.
- Closure-evidence artifacts at `.pr-2-1-artifacts/{schema-diff,smoke-run,migration-verify,typecheck}.txt`.

**What carries forward to PR-2.2:**
- **Vocabulary gaps from V1.** Three out-of-vocab axes from a single virtual-service smoke product. PR-2.2 planning needs to decide: (a) expand FASHION vocabulary to cover service products, or (b) treat as expected gaps for non-garment inventory and defer to a future SERVICE/HYBRID mode. PR-2.2's first-pass run reveals whether non-garment products are common enough to need their own vocabulary.
- **Cost calibration.** Smoke per-product cost ($0.007077) exceeded the $0.005 default cap by 41%. PR-2.2's first-pass on 1,169 products produces a real distribution. After first-pass, decide whether to raise per-product cap to $0.010, keep $0.005 (let high-token products fail post-call), or implement pre-call token-budget estimation with prompt trimming.
- **4 pre-existing RULE/PENDING_REVIEW rows** lift to APPROVED organically during PR-2.2's catalog-wide first-pass via the `rule-engine.server.ts` change. No explicit cleanup pass needed.
- **Single-writer contract** preserved by construction. PR-2.1 smoke confirmed zero `prisma.product.update`/`prisma.product.upsert` calls outside `upsertProductKnowledge`. PR-2.2's first-pass routes through the same tagging-jobs queue + worker-tagging loop, so the contract is structurally enforced.

**Phase 2 progress (PR-2.1 entry):** 1 of 3 sub-PRs shipped at this point. Updated below after PR-2.2.

### PR-2.2 — First-pass tagging + vocabulary calibration ✓ SHIPPED

**Shipped:** Five mechanical commits + close — `a7c196a` (mech), `a0a640f` (mech.1), `a1ae025` (mech.2), `35ca74e` (mech.3), `86fe3b9` (mech.4), close at this commit.

**`a7c196a` — INITIAL_BACKFILL handler + kickoff/reporter scripts + non-FASHION schema-validation comments.**
- New `app/server/worker-tagging-backfill.ts` replaces PR-2.1's "cancelled-not-implemented" stub with a real handler. Cursor-resume via `summary.lastProcessedProductId` (page-100 id-ASC pagination); mid-run budget check at 25-product granularity; per-product failure isolation (errorClass taxonomy increments `failedProducts`, continues); shouldStop checked at top of each iteration only (mid-product SIGTERM not honored — paid tokens land in DB).
- Worker-tagging.ts INITIAL_BACKFILL branch delegates to the new handler. shouldStop plumbed through the call chain. New observability event `tagging_queue_blocked_by_backfill` emits when a SINGLE_PRODUCT/MANUAL_RETAG job claimed after >5min QUEUED finds a RUNNING INITIAL_BACKFILL on the same shop (pure observability — no behavior change).
- Kickoff script `scripts/start-fashion-backfill.mjs` with `--shop` (required), `--limit N`, `--force`, `--skip-confirm`. Pre-execution checks: shop exists, prior-backfill detection with override, runtime cost projection from 30-product description-length sample × cost-per-Kc anchor.
- Reporter script `scripts/report-backfill.mjs` (later .ts at mech.3) emits six closure-evidence artifacts: run-summary, vocab-gap-distribution, cost-reconciliation, rule-coverage, cost-histogram, sample-audit (15-50 stratified products by 2.5% rule).
- Schema-validation comments added to `axis-options.ts` for ELECTRONICS/FURNITURE/BEAUTY/JEWELLERY/GENERAL marking each "validated as-is, no production exposure yet, revisit when first MODE merchant onboards." GENERAL gains an extra comment documenting the deliberate-minimal fallback design.
- `.env.example` `TAGGING_COST_PER_PRODUCT_USD_MICROS` comment updated to make the spec/reality gap explicit (informational target only — not enforced pre-call). 13 new tests (7 backfill handler + 6 queue-collision event).

**`a0a640f` — FASHION vocabulary extension: sustainability + season.**
- Response to PR-2.2-mech limited-5 take-1 evidence: AI proposed `sustainability` for 4/5 products (80% hit-rate, value `eco_friendly`) and `season` for 3/5 (60% hit-rate, values `all_season`, `summer`). Both above the 10% extension threshold.
- `sustainability` (multi, 8 values incl. `conventional` fallback to prevent forced-omission for non-sustainable products). INFERRED from product description language; merchants reviewing in 2.3 should validate against actual sourcing.
- `season` (multi, 7 values incl. India-relevant `monsoon` and `transitional` for spring/autumn middle-ground).
- STARTER_AXES.FASHION picks both up automatically via `Object.keys(AXIS_OPTIONS.FASHION)` — no plumbing change to ai-tagger or rule-engine. New `app/lib/catalog/store-axes.test.ts` (6 tests) pins the additions and asserts the STARTER_AXES↔AXIS_OPTIONS consistency.

**`a1ae025` — rule-engine re-tag bug fix.**
- Caught during PR-2.2 limited-5 take-2 (re-run on already-tagged products produced 53% fewer tag proposals than take-1). Pre-fix, `applyRules` built `axesWithExistingValue` from product.tags WITHOUT filtering by status, then used it both for the rule-write filter AND for the returned `axesStillNeeded`. Result: PENDING_REVIEW tags from a prior AI run blocked the AI from re-evaluating those axes on subsequent runs, contradicting the PR-2.1 design intent (APPROVED sticky, REJECTED exclusion, PENDING_REVIEW replaceable).
- Fix is a two-set split: `axesWithExistingValue` (status-agnostic, UNCHANGED) used by the rule-write filter to preserve "purely additive" rule semantic; new `axesWithStickyValue` (APPROVED + REJECTED only) used by `axesStillNeeded` to gate the AI prompt. Surgical scope — no rule-write semantic change.
- New `app/lib/catalog/rule-engine.test.ts` (6 tests) covers the regression: PENDING_REVIEW non-sticky, APPROVED sticky, REJECTED sticky (pins current axis-level behavior), dual-guard interaction, locked-axes regardless-of-status, baseline empty-tags.
- Existing test in `tag-review-state.test.ts:205` relabeled — the original "PENDING_REVIEW tags from prior runs stay PENDING_REVIEW on regen" overclaimed prompt-construction behavior; relabeled to "PENDING_REVIEW status is preserved when upsert re-suggests the same (axis, value)" with a comment pointing to rule-engine.test.ts for the prompt-construction filter tests.

**`35ca74e` — reporter `.mjs` → `.ts` conversion.**
- Caught during PR-2.2 limited-5 take-3 false-positive: the reporter flagged sustainability and season as POTENTIAL VOCABULARY EXTENSION CANDIDATEs even though both were added in mech.1. Diagnosis: `scripts/report-backfill.mjs` had hand-mirrored copies of STARTER_AXES + AXIS_OPTIONS.FASHION at the top of the file with a "keep in sync" comment that broke at mech.1.
- Fix: convert `.mjs` → `.ts`, run via tsx (already a project dep). Replace hardcoded constants with `import { STARTER_AXES } from "../app/lib/catalog/store-axes"` and `import { AXIS_OPTIONS } from "../app/lib/catalog/axis-options"`. Single source of truth — same module graph the AI prompt construction uses.
- Exported helper `classifyTagPair(axis, value, mode)` with discriminated-union return shape (`axis-not-in-vocab` / `free-form-allowed` / `in-vocab` / `out-of-vocab`). Standard ESM "is-this-the-entry-point" guard around `main()` so vitest can import the helper without triggering DB connection.
- `vitest.config.ts` `include` extended to `["app/**/*.test.ts", "scripts/**/*.test.ts"]` so the new `scripts/report-backfill.test.ts` is discovered (24 tests). Kickoff script's printed reporter invocation updated from `node scripts/report-backfill.mjs` to `npx tsx scripts/report-backfill.ts`. Three references found across the entire repo, all within `scripts/`; zero in README/CLAUDE/HANDOFF/docs.

**`86fe3b9` — FASHION vocabulary extension: sleeve_length + pattern + collar_type; cost-per-Kc anchor recalibration.**
- Response to PR-2.2 n=50 take-4 evidence: AI proposed `sleeve_length` for 30/50 products (60%), `pattern` for 16/50 (32%), `collar_type` for 16/50 (32%). All well above the 10% extension threshold.
- `sleeve_length` (single, 7 values — both half_sleeve/short_sleeve and full_sleeve/long_sleeve intentionally included; industry uses both interchangeably, Indian-fashion context tends to use half/full).
- `pattern` (single, 11 values — solid/striped/pinstripe/checked/gingham/plaid/printed/embroidered/jacquard/textured/colorblock; niche patterns like paisley/batik/ikat excluded — AI can propose, will surface as out-of-vocab signal if hit-rates warrant).
- `collar_type` (single, 12 values covering common shirts + Indian-ethnic + jacket variants).
- DELIBERATELY did NOT add `collar_style` — the AI inconsistently used both `collar_type` and `collar_style` for the same concept (14% hit-rate on collar_style). Schema canonicalizes on `collar_type`. The omission is pinned via `expect(fashion).not.toContain("collar_style")` in store-axes.test.ts.
- Cost-per-Kc anchor recalibrated `$0.0011` → `$0.0032` from n=50 actual data ($0.3502 / 108.75 Kc). Three consecutive runs (smoke + take-1 + n=50) showed ~190%+ projection-vs-actual divergence under the old anchor. New anchor accounts for the per-call constant overhead (system prompt + axis vocabulary + product metadata) the smoke-derived value undercounted. 12 new tests (5 in store-axes.test.ts, 7 in report-backfill.test.ts).

**Verification:** n=50 limited backfill on 2026-05-04 against `ai-fashion-store.myshopify.com` (jobId `cuid_9cfc2379b77347bcaffc05af0b00a45e`).
- 50/50 products processed (100%), 0 failures.
- Total cost $0.3502 (3.5% of $10 backfill budget).
- Wall-clock 3.0 min, ~3.6s per product.
- 49,340 input tokens / 13,479 output tokens. Mean per-product cost $0.007004.
- Zero Anthropic errors across all 5 classes.
- Sample audit (n=15 stratified): AI demonstrated product-type-aware tagging across diverse FASHION garment families — boxers, trousers, shirts, jackets, co-ord sets, kurta sets, dresses. Color, fit, sleeve, pattern, collar values varied appropriately per product (no flat-line "casual on everything" failures). The vocabulary additions from mech.4 will resolve the 14.7% out-of-vocabulary density observed pre-mech.4 in this run; reporter rerun against the same TaggingJob row post-mech.4 expected to show ~4-6% residual (genuine minor candidates below the 10% threshold).
- Closure-evidence artifacts at `.pr-2-2-artifacts/{run-summary, vocab-gap-distribution, cost-reconciliation, rule-coverage, cost-histogram, sample-audit}.txt`.

**What carries forward to PR-2.3:**
- **Orphan PENDING_REVIEW tags using axis `collar_style` from the n=50 run.** Deliberately not added to schema (the AI inconsistently named the concept). Merchant rejects them via the Phase 4 portal review UI when it lands. PR-2.2-mech.2's `axesStillNeeded` filter prevents collar_style from being re-suggested on subsequent runs in the meantime — the schema only contains collar_type going forward.
- **Minor vocabulary candidates from n=50 below the 10% threshold:** `skin_friendliness` 8%, `fabric_weight` 8%, `fabric_treatment` 8%, `pleat_style` 6%. Defer; the Phase 4 portal review UI will surface them as merchant-rejectable tags. If catalog-wide hit-rates rise post-merchant-traffic, revisit.
- **First-pass tagging on the full dev catalog was DEFERRED.** The n=50 evidence verified mechanical correctness, AI quality, and vocabulary alignment. Running unlimited (~$5-8 spend) would produce confirmatory not exploratory evidence. Full-catalog tagging is now a normal merchant-triggerable operation via the Phase 4 portal review UI's "Tag all products" action, not a Phase 2 verification step.

**Phase 2 progress:** 3 of 3 sub-PRs shipped (PR-2.1 + PR-2.2 + PR-2.3 closure record). Phase 2 CLOSED. Tagging review UI deferred to Phase 4 portal scaffold sub-bundle 4.3.

---

## Phase 3 — Pipeline rewrite + reviews + order ingest + AI attribution ▶ IN PROGRESS

**State:** Sub-bundle 3.1 (Pipeline core + eval harness + conditional re-embed) opened 2026-05-05. mech.1 (schema migration + eval harness scaffolding + 12 fixture stubs) shipped this commit. Five more mech commits follow (HARD_FILTER_AXES + Stage 1 → Stage 2 → Stage 3 → Stages 4/5/6 → v2 tool wired but unregistered + integration test + eval baseline) before 3.1 closes. The flip commit that swaps the agent's `recommend_products` registration to the v2 pipeline is post-eval-pass and is NOT part of 3.1.

**Goal:** Six-stage pipeline live (brief §4). Reviews ingested into knowledge record. Orders ingested for sales velocity + attribution. AI revenue attribution rows write on every recommendation event and reconcile on every order. FASHION mode end-to-end verified.

**Scope:**
- Six-stage pipeline implementation (brief §4): hard filters, semantic retrieval, structured re-rank, merchant signal injection, diversity + business rules, final scoring + output. Each stage independently testable.
- Pipeline integration with `recommend_products` tool — replaces current embed-and-match wrapper.
- Re-embed strategy decision: re-embed all 1,169 products against new knowledge record on Phase 3 open, or progressive re-embed only on next content change. Decide in planning. Cost budget set.
- Review provider integration (Yotpo or Judge.me — pick at start of phase based on dev-store availability). Read-only. Reviews flow into product knowledge record (text + rating + sentiment + fit/sizing where exposed).
- Order ingest: `orders/create` + `orders/updated` webhooks (subscribed in PR-C) → write structured order events. Sales velocity rolling windows (7d / 30d / 90d) computed nightly.
- AI attribution: every `recommend_products` tool call result writes `RecommendationEvent` rows with full pipeline trace. `orders/create` checks 7-day window for attribution match, writes `AttributionEvent` rows. Defaults configurable per merchant.
- FASHION mode re-rankers (Stage 3): occasion + body type + fit + color preference. Other modes' re-rankers are Phase 5+.

**Out of scope:** Other modes' re-rankers (Phase 5). Conversations module UI (Phase 5). Customer Profile UI (Phase 4). Merchant signal injection UI (Phase 4 — config screen).

**Inputs needed:** Re-embed cadence decision. Review provider choice. Attribution window default.

**Bundling:** Three internal sub-bundles.
- 3.1: Pipeline stages 1-6 + eval harness + conditional re-embed
- 3.2: Review provider + order ingest + sales velocity
- 3.3: Attribution writes + reconciliation + audit trail

**Acceptance:**
- "Show me best sellers" returns actual top-selling dev-store products from order data, not vibes
- "Show me daily wear shirts" returns shirts with style=daily, formality=casual — not festive kurtas (the v0.2 misfire example)
- OOS handling: high-relevance OOS product flagged, near-substitute shown — not "may have sold out" hand-wavy reply
- Reviews-derived signal verifiable: a product with mostly-positive reviews + good fit feedback ranks above an equivalent product with bad reviews
- Attribution: place a test order in dev store after a chat session that recommended a product → verify `AttributionEvent` row exists with full trace → click trace → see exactly which `recommend_products` call led to it

### Sub-bundle 3.1 — Pipeline core + eval harness + conditional re-embed ▶ IN PROGRESS

**Locked decisions (planning round, 2026-05-05):**
- Re-embed cadence: conditional re-embed in 3.1 via new `TaggingJobKind=RE_EMBED` (skip predicate `embeddingContentHash IS NOT NULL AND embeddingContentHash = knowledgeContentHash`); one-time bulk pass for the dev shop's NULL-hash rows in 3.1.5 (separate execution prompt).
- NO blog scraping / brand voice ingestion in Phase 3 (deferred to Phase 8).
- Latency budget: 8s p95 / 5s p50 end-to-end on dev shop. Enforced at flip-commit gate.
- Hard-filter axes hardcoded in `app/lib/catalog/store-axes.ts` as `HARD_FILTER_AXES` (mech.2). Default FASHION = ["gender", "category"]; other modes = []. Phase 4 portal AI Agents config UI surfaces editable values.
- Feature-flag pattern: structural, not env-var. v2 pipeline built but the agent's tool registry continues to call the OLD `recommend_products` for the entirety of 3.1. A separate post-eval-pass commit performs the one-line registry flip.
- Eval harness ships FIRST (mech.1). Without measurable quality, every Phase 5+ pipeline change ships against vibes.
- Stage numbering: v0.3 brief numbering. Stage 0 (query extraction, the pre-step) is named explicitly in trace.stages so audits stay honest; Stages 1-6 match the brief.
- Stage 5 quotas are SOFT with fallback. First pass applies quotas; if output count < N, second pass fills remaining slots from rejected candidates preserving relevance order; trace records `diversityQuotaFallback: true` when fallback fires.
- Eval threshold IS the mech.6 baseline. Lowering post-baseline requires a HANDOFF amendment with rationale; raising is fine without ceremony.

**Surface conditions (locked at planning round close):**
- C1. Chat tools live at `app/lib/chat/tools/` (registry: `registry.server.ts:11-15`; flip commit changes that import only). NOT `app/lib/agent/`.
- C2. Stage 2 reuses `app/lib/embeddings/similarity-search.server.ts` via a new sibling function `findSimilarProductsAmongCandidates` (added in mech.3, not mech.1).
- C3. `TaggingJob` is also the embedding queue. Naming debt recorded; do NOT rename in 3.1.
- C4. Dev catalog is **2,632 products** (not 1,169 — that was the production-live filtered count pre-PR-B). PR-B shipped 2,632 fully-ingested products. Subtlety: `recommend_products` operates on the buyable subset (status=ACTIVE, recommendationExcluded=false, at least one variant availableForSale=true), but Drafts can flip to Active mid-session, so embeddings cover all 2,632 rows. 3.1.5's bulk re-embed pass projects against 2,632, not 1,169.
- C5. Pre-existing typecheck error at `app/routes/app.config.tsx:280` stays as documented baseline (1 pre / 1 post). Tracked separately at "Key operational debt".

#### PR-3.1-mech.1 — Schema migration + eval harness scaffolding ✓ SHIPPED

**Shipped:** This commit. First internal commit of sub-bundle 3.1.

**Schema additions (single migration `20260505100000_phase_3_1_pipeline_schema/migration.sql`, hand-authored, IVFFlat-stripped per HANDOFF:719):**
- `ALTER TYPE "TaggingJobKind" ADD VALUE 'RE_EMBED'`. The TaggingJob queue now doubles as the embedding queue (cost ledger, heartbeat, dedup, error class taxonomy all match Voyage work shape exactly). Worker handler that processes RE_EMBED rows lands in mech.6.
- `Product.recommendationPromoted` Boolean, default false. Sibling to `recommendationExcluded`. Stage 4 of v2 pipeline reads it. No index in 3.1 — Stage 4 reads on Stages 1+2 narrowed candidate set (~30-100 products).
- `EvalQueryMode` enum (mirrors StoreMode values; kept separate so EvalQuery's mode can diverge from merchant `storeMode` without coupling).
- `RecommendationEvent` table (write-only in 3.1; reads in 3.2 for AI revenue attribution per brief §7). `traceVersion` is a real top-level column for cheap slice queries; `intent` matches `PipelineInput.intent` field name (one name for the concept everywhere).
- `EvalQuery` + `EvalRun` + `EvalResult` tables. `EvalRun.kind` discriminates "PIPELINE" today; future "TAG_QUALITY" eval (deferred until Phase 4 portal review UI calls for it) lands additively. `EvalFixture` table NOT shipped in 3.1 — pipeline-quality eval is the 3.1 work.
- Reverse relations on `CustomerProfile` + `CustomerSession` to `RecommendationEvent[]`.

**Eval harness scaffolding shipped:**
- `app/lib/recommendations/v2/eval/scoring.ts` — pure scoring primitives: `precisionAtK`, `relaxedMatchAtK`, `combinedScore` (0.7 × relaxed + 0.3 × precision when expectedHandles populated; relaxed-only otherwise), `classifyStatus` (PASS ≥ 0.75 / PARTIAL ≥ 0.50 / FAIL otherwise). 5 unit tests in `scoring.test.ts` cover the metric edges per plan §10.
- `app/lib/recommendations/v2/eval/runner.server.ts` — `PipelineRunner` interface + `NoOpPipelineRunner` (returns empty top-K — the empty-baseline driver). `runFixtureAgainstPipeline(fixture, runner)` wraps a single run with try/catch; errors surface as FAIL with `errorMessage` rather than aborting an aggregate run.
- `app/lib/recommendations/v2/eval/cli.ts` — `runEval` library function that loads EvalQuery rows, runs the PipelineRunner against each, and persists exactly one EvalRun + N EvalResult rows in a single `$transaction`.
- `scripts/run-eval.ts` — CLI dispatcher (`--all` / `--fixture=<key>` / `--shop=<domain>`). Default shop `ai-fashion-store.myshopify.com`. Exit 0 on harness completion (mech.1 does NOT enforce a quality gate; mech.6 will).
- `scripts/eval-fixtures-sync.ts` — idempotent upsert of `app/lib/recommendations/v2/eval/fixtures/*.json` into `EvalQuery` keyed by `(shopDomain, fixtureKey)`. Removed-from-disk fixtures are NOT auto-deleted.
- `scripts/report-pipeline-3-1.ts` — stub one-section reporter for the most recent EvalRun. Fully-fleshed in mech.6.

**12 fixture stubs in `app/lib/recommendations/v2/eval/fixtures/`:**
- 4 specific-attribute: linen-shirts-white, oversized-fit-kurta, festive-kurta-women, summer-shorts-size-m
- 4 vibe: minimalist-daily-wear (HANDOFF acceptance line 333), wedding-reception, casual-office-shirts, going-out-outfit
- 2 explicit category: show-jackets, show-trousers (synonym test: "trousers" → category=pants)
- 2 OOS-stress: oos-stress-1 (HANDOFF acceptance line 334), oos-stress-2

All 12 fixtures land with `expectedTagFilters` populated (derived from FASHION axis vocabulary in `axis-options.ts`) and `expectedHandles` empty. Midhun fills handles in via Prisma Studio inspection of the dev catalog before mech.6's baseline run; until then scoring falls back to relaxed-match-only.

**Verification:**
- `npm run lint`: clean.
- `npm run typecheck`: 1 error (pre-existing baseline at `app/routes/app.config.tsx:280` — same as PR-2.1 / PR-2.2 baseline).
- `npm run build`: clean. 146 SSR modules transformed; client bundles built; 0 errors.
- `npm test`: 200/200 pass (195 pre-mech.1 + 5 new scoring tests = 200). All 17 test files green.
- `npx prisma validate`: schema valid.
- `npx prisma migrate diff --from-empty --to-schema-datamodel`: 790 lines of generated SQL include all four new tables (`RecommendationEvent`, `EvalQuery`, `EvalRun`, `EvalResult`), the `RE_EMBED` enum addition, the `recommendationPromoted` column, and the `EvalQueryMode` enum. IVFFlat `Product_embedding_cosine_idx` is absent from the generated SQL (Prisma DSL doesn't model it) — confirms the documented known-exception will surface on any future from-DB diff and must be stripped from migration SQL hand-author passes.

**What's deferred to mech.2-6 inside this sub-bundle:**
- mech.2: HARD_FILTER_AXES constant in `store-axes.ts` (alongside `STARTER_AXES`) + Stage 1 hard-filters module.
- mech.3: Stage 2 (semantic retrieval against Stage 1 narrowed candidate set) + `findSimilarProductsAmongCandidates` sibling in `similarity-search.server.ts`.
- mech.4: Stage 3 query extraction (heuristic, not LLM call — latency budget) + FASHION re-rankers (occasion / fit / color / body-type).
- mech.5: Stage 4 (NULL-safe sales velocity handling — 3.2 lands real data) + Stage 5 (greedy MMR diversity + soft-quota fallback + OOS substitution) + Stage 6 (output shape + whyTrace template).
- mech.6: v2 tool (`recommendProductsV2Tool`, NOT registered in agent path) + pipeline orchestrator + RE_EMBED worker handler + `voyage-cost.server.ts` + integration test + eval baseline run.
- 3.1 close: closure-evidence artifacts (`.pr-3-1-artifacts/`).

**Empty-baseline run gating (post-deploy):** `npx tsx scripts/eval-fixtures-sync.ts` then `npx tsx scripts/run-eval.ts --all` against the Railway-deployed schema is the verification that the harness plumbing works end-to-end. Expected output: 1 EvalRun row (kind="PIPELINE", pipelineVersion="3.1.0-empty", aggregateScore=0.0, passCount=0, partialCount=0, failCount=12) + 12 EvalResult rows all status=FAIL score=0 topKHandles=[]. This run requires Railway deploy to apply the migration first; runs after push.

---

## Phase 4 — SaaS portal foundation + Customer Profile + Dashboard Overview

**Goal:** SaaS portal exists as a separate Next.js app deployed on Railway. App Bridge SSO works. Shared component library + design tokens + API contracts established. Three modules functional: Dashboard Overview, Customer Profile, AI Agents config. Embed app gets "Open Dashboard" button that lands authenticated in portal.

**Scope:**
- New Next.js app scaffold (separate Railway service, shared Postgres with role-separated connection pool)
- App Bridge SSO: token exchange, session validation against Shopify, portal-side session cookie
- Shared component library + design tokens (Tailwind + shadcn — confirm at phase start)
- Shared API contracts (server actions + REST where needed)
- Dashboard Overview module: KPI cards (sessions, conversions, AI-attributed revenue, lookbook downloads), recent activity feed, quick action shortcuts
- Customer Profile module: list view (search, filter, sort), detail view (identity, attributes, behavioral history, lookbook history), mode-aware section show/hide
- AI Agents config module: personality/tone editor, capabilities toggles (commerce on/off, stylist on/off, etc.), brand voice text editor, live preview, performance indicators (chat count, conversion rate)
- Functional v0 UI per brief §12 — Polaris-equivalent quality, designed v1 in Phase 12
- Localization scaffolding (i18n layer, English-only at launch)

**Out of scope:** Conversations module (Phase 5). Quiz Builder UI (Phase 6). Lookbook (Phase 7). Knowledge Base (Phase 8). Analytics deep dive (Phase 10). Settings polish (Phase 12).

**Inputs needed:** UI design from PDF for portal shell, dashboard overview, customer profile, AI agents. Shared component library tech choice (recommendation: Tailwind + shadcn).

**Bundling:** Three internal sub-bundles.
- 4.1: Portal scaffold + App Bridge SSO + shared component library + design tokens
- 4.2: Dashboard Overview module
- 4.3: Customer Profile + AI Agents config modules

**Acceptance:**
- Click "Open Dashboard" in embed app → land authenticated in SaaS portal at portal URL → see dashboard overview KPIs populated from dev-store data
- Customer Profile list shows all dev-store customers; detail view shows identity + attributes + order history + (empty) chat history
- AI Agents config screen edits propagate to chat agent behavior (e.g. tone change reflected in next chat session)
- Mode-aware show/hide working: switching `storeMode` in dev (or mocking it) shows/hides the right dashboard sections

---

## Phase 5 — Conversations module + attribution event tracking + anonymous session merge

### MILESTONE: First soft-launch.

**Goal:** Every chat captured, conversations module live in SaaS portal (read-only), attribution events flow through to dashboard. Anonymous-to-identified session merge works. After this phase, the product is usable by a real paying merchant.

**Scope:**
- Conversation capture: every user message + agent response + tool call result stored on `Conversation` + `ConversationMessage`
- 90-day retention enforced via daily cron (raw transcripts deleted after 90 days; derived signals survive indefinitely)
- Conversations module in SaaS portal: list view (search, date filter, customer filter, intent filter, outcome filter), detail view (full transcript, tool call inspection, "why this rec" trace expansion), bad-rec flagging UI (input for the learning system)
- Attribution event UI in dashboard: AI-attributed orders list, click any → see attribution trace
- Anonymous session merge logic: lookbook download path (Phase 7 wires the trigger; Phase 5 builds the merge primitive), substantive quiz completion path (Phase 6 wires the trigger; Phase 5 builds the primitive)
- Email-match merge: anonymous session with email matching a known `CustomerProfile` merges; email matching a guest-checkout email also merges retroactively
- Conversations export (CSV — JSON deferred unless first soft-launch merchant asks)

**Out of scope:** Reply as AI (removed from scope per scope-decisions). Live merchant notifications (intentionally not built). Conversation analytics deep-dive (Phase 10). Quiz UI (Phase 6).

**Inputs needed:** UI design from PDF for conversations list + detail.

**Bundling:** Three internal sub-bundles.
- 5.1: Conversation capture + retention cron + attribution event surface
- 5.2: Conversations module UI
- 5.3: Anonymous session merge primitive + email match

**Acceptance:**
- Send a chat in dev storefront → see it in conversations module within 10s
- Tool call result expansion shows full trace including topDistance and pipeline stage contributions
- 90-day retention cron tested with backdated rows → only old rows deleted, derived signals preserved
- Anonymous session that provides email matching a known customer → merges into that `CustomerProfile`
- Bad-rec flag captures merchant feedback for learning system input
- AI-attributed order in dashboard → click → see exact recommendation event chain back to chat

**Milestone trigger: First soft-launch.** Onboard one paying merchant. Real feedback. Anything broken here gets fixed before Phase 6.

---

## Phase 6 — Stylist Agent + Quiz Builder

**Goal:** Stylist Agent rebuilt against the new pipeline + customer profiles. Quiz engine drives substantive customer profiling. Quiz Builder UI in SaaS portal (visual editor — JSON config v1 fallback in cut-list).

**Scope:**
- Stylist Agent rewrite: uses customer profile attributes from Phase 5, runs through full six-stage pipeline (Phase 3), mode-aware system prompt, brand voice from AI Agents config (Phase 4)
- Quiz engine: nested branching tree, three question types (single-select, multi-select, free-text), conditional logic, completion thresholds, identification trigger at 4+ questions answered
- Quiz Builder UI in SaaS portal: visual tree editor, question type pickers, branching condition editor, flow preview, completion logic editor, save/publish workflow
- Mode-specific quiz schemas: FASHION (body type, fit, occasion, style); ELECTRONICS (use case, budget, brand affinity, environment); BEAUTY (skin type, concerns, ingredients, regimen); FURNITURE (room type, dimensions, material, function); GENERAL (lightweight)
- Quiz UI in storefront chat widget: in-chat questions one-by-one, skippable, partial-completion saves anonymous attributes, 4+ completion identifies and merges

**Out of scope:** Image upload + body type analysis (Phase 9 — wired into quiz post-submission). Lookbook generation (Phase 7).

**Inputs needed:** UI design from PDF for Quiz Builder + in-chat quiz UI. Mode-specific quiz schemas drafted (FASHION confirmed, others sized).

**Bundling:** Three internal sub-bundles.
- 6.1: Stylist Agent rewrite + brand voice integration + mode-aware prompt
- 6.2: Quiz engine (data model, branching logic, identification trigger)
- 6.3: Quiz Builder UI + in-chat quiz UI

**Acceptance:**
- Stylist Agent uses customer profile in recommendations (same query, identified vs. anonymous customer → different ranking)
- Quiz Builder lets merchant edit quiz tree, preview flow, save, publish
- Substantive quiz completion (4+) identifies anonymous session and merges
- Brand voice config in AI Agents screen reflected in next chat session
- All 5 store modes have at least a baseline quiz (richer FASHION + sketches for others)

**Cut-list option:** Cut Quiz Builder UI to JSON-config v1 (engineer edits JSON file, ships post-launch as visual editor).

---

## Phase 7 — Lookbook system

### MILESTONE: Differentiator activates.

**Goal:** Personalized lookbook PDFs generated for FASHION mode, gated on identification (email + mobile), saved to customer profile, downloadable. The differentiator activates.

**Scope:**
- Lookbook generation: LLM-orchestrated outfit combination against catalog + customer profile + style rules + merchant brand voice. 8-15 outfits per lookbook, 3-7 products per outfit, sized + fit-noted.
- PDF rendering: react-pdf (default per brief §17 open question; revisit if Puppeteer needed for image quality). Server-side. Branded to merchant's store. Customer's name on cover.
- Identification gate UI in chat: "Download your lookbook" → email + mobile capture → gated download URL
- Lookbook storage on customer profile, re-downloadable, history surfaces in Customer Profile module (Phase 4)
- Lookbook download tracked as identification trigger (Phase 5 anonymous merge wiring)
- Lookbook download history surfaces in conversations module + customer profile module

**Out of scope:** AI image generation for outfit composition (deferred — too risky for brand-sensitive merchants in v1). Lookbook editing by merchant (post-launch). Multi-language lookbooks (post-launch).

**Inputs needed:** UI design from PDF for lookbook viewer + download gate. PDF rendering library decision.

**Bundling:** Two internal sub-bundles.
- 7.1: Lookbook generation engine + PDF rendering
- 7.2: Identification gate UI + storage + customer profile integration

**Acceptance:**
- Click "Generate lookbook" in dev storefront chat as anonymous user → email + mobile gate appears
- Provide email + mobile → lookbook generates → PDF downloadable
- PDF renders with 8+ outfits, branded, named, with shop-this-look links to dev-store products
- Lookbook saved to customer profile, re-downloadable from Customer Profile module in SaaS portal
- Anonymous session that downloaded a lookbook merges into `CustomerProfile` keyed on email

**Milestone trigger: Differentiator activates.** Lookbook is the highest-converting customer-touching artifact in the product. Word-of-mouth starts here.

---

## Phase 8 — Knowledge Base

**Goal:** Merchant FAQ + blog + uploaded document ingest. Agent answers brand-and-policy questions ("what's your return policy", "is there a store near me", "tell me about your sustainability practices") from merchant's own content, not generic LLM training data.

**Scope:**
- FAQ ingest: structured Q&A pairs entered in SaaS portal Knowledge Base module
- Blog ingest: Shopify blog API → fetch + chunk + embed
- Document upload: PDF + text upload → chunk + embed
- Knowledge retrieval tool for agent: separate from `recommend_products`. Retrieves FAQ/blog/doc passages on policy-style queries.
- Knowledge Base module in SaaS portal: FAQ editor, blog sync status, document upload + management, knowledge query test bench
- Stale-content detection: blog post updated → re-ingest. Document update → re-ingest. FAQ edit → re-embed.

**Out of scope:** Multi-language knowledge base (post-launch). Auto-FAQ generation from chat history (v2 idea).

**Inputs needed:** UI design from PDF for Knowledge Base module.

**Bundling:** Two internal sub-bundles.
- 8.1: FAQ + blog ingest + retrieval tool
- 8.2: Document upload + KB module UI

**Acceptance:**
- "What's your return policy?" returns merchant's actual policy from FAQ, not generic
- "Tell me about your sustainability practices" pulls from a blog post if present
- Document upload tested with a 20-page PDF → chunked → queried → relevant passage retrieved
- KB module lets merchant test queries before publishing

**Cut-list option:** Defer Phase 8 to post-launch. Apply if scope pressure hits.

---

## Phase 9 — Size & Fit + Color Logic + Image upload + Body type

**Goal:** FASHION-mode quality enhancements. Size recommendation, fit guidance, color matching, optional body image analysis.

**Scope:**
- Image upload UI in storefront chat (after substantive quiz, FASHION mode only): front, back, side images. Encrypted at rest. 90-day retention default unless customer saves to profile.
- Body type analysis: LLM-with-vision against uploaded images → body type estimation, size recommendation, fit guidance. Confidence-scored. Privacy posture clearly disclosed in upload UI.
- Size guide ingest from merchant: metafield mapping or manual entry in Settings module. Per-product or per-collection size charts.
- Fit preference extraction from quiz + chat (e.g. "I prefer oversized" → store as fit preference, use as Stage 3 re-rank input)
- Color logic: dominant color extraction per product image (vision API), color family classification, complementary color recommendations for outfit building
- All of the above feed Stage 3 re-ranker for FASHION queries

**Out of scope:** Custom body-type model (v2 quality investment per brief §17). Color logic for non-FASHION modes (v2).

**Inputs needed:** UI design from PDF for image upload UI. Body-type model provider decision (recommendation: LLM-with-vision for v1).

**Bundling:** Three internal sub-bundles.
- 9.1: Image upload + body type analysis + privacy plumbing
- 9.2: Size guide ingest + fit preference extraction + size recommendation
- 9.3: Color logic + Stage 3 re-rank integration

**Acceptance:**
- Upload front/back/side images → body type estimation returns within 30s with confidence score
- "Show me workwear that fits well" returns products sized to recommendation, fit-rated for body type
- Color match: "Show me tops that go with my black trousers" returns color-coordinated suggestions
- Privacy: customer can delete images from profile → cascades to derived embeddings

**Cut-list option:** Defer Phase 9 entirely. FASHION recommendations work without Size/Fit/Color, just less precisely.

---

## Phase 10 — Analytics deep + Pricing/Billing + Attribution UI

### MILESTONE: Pricing flips on.

**Goal:** Full analytics suite live. Pricing model architecturally complete. Stripe + Shopify Billing API integrated. Tier names + dollar amounts + caps decided + flipped on. Existing soft-launch merchants migrate from comp to paid.

**Scope:**
- Analytics module: revenue attribution dashboard, engagement funnel, product performance, conversation outcomes, top-converting recommendations, cohort retention
- AI revenue attribution UI: filterable + exportable + auditable
- Conversation-based metering: per-merchant monthly conversation counter, billing-period aware
- Plan + cap data model implementation: `MerchantPlan` row with tier + conversation cap + order/revenue cap + overage policy
- Soft warnings (80%) + hard caps (100%) + email notifications
- Shopify Billing API integration (mandatory for App Store apps that charge)
- Stripe integration scaffolded for future non-Shopify merchants (inactive at launch)
- Plan & usage UI in SaaS portal Settings module
- Trial period support
- Pre-launch decision: tier names, dollar amounts, conversation caps, order/revenue caps, overage rates, free trial length

**Out of scope:** Stripe activation for non-Shopify merchants (year 2). Custom enterprise contracts (case-by-case).

**Inputs needed:** UI design from PDF for analytics + plan/usage screens. Pricing decisions (made before this phase ships).

**Bundling:** Three internal sub-bundles.
- 10.1: Analytics module
- 10.2: Pricing data model + metering + Shopify Billing API + Stripe scaffold
- 10.3: Plan/usage UI + trial + tier flip-on

**Acceptance:**
- Analytics dashboard shows AI-attributed revenue, conversion rate, top products, cohort retention from real dev-store + soft-launch merchant data
- Charging a test merchant via Shopify Billing API works end-to-end
- Soft warnings fire at 80% conversation usage; hard caps fire at 100%
- Audit-grade attribution: dispute test → click any AI-attributed order → see full chain to chat → merchant satisfied

**Milestone trigger: Pricing flips on.** Soft-launch merchants migrate to paid. Real revenue starts.

---

## Phase 11 — Integrations launch set

### MILESTONE: Launch-ready.

**Goal:** Three integrations live (Meta Pixel, GA4, review provider). Integration framework in place so post-launch additions are quick.

**Scope:**
- Integration framework: common `Integration` model, OAuth/API-key onboarding flow, common event-emit interface, per-provider adapter pattern, integrations dashboard in SaaS portal
- Meta Pixel: PageView, ViewContent, AddToCart, Purchase + custom chat events (chat_started, agentic_add_to_cart, agentic_purchase). Pixel ID config + event deduplication.
- GA4: Same events + GA4 custom dimensions for AI attribution. Measurement ID + API secret.
- Review provider: Yotpo or Judge.me confirmed in Phase 3 — Phase 11 finishes the bidirectional flow (read + UI surfacing in product page widget if applicable).
- Integrations module in SaaS portal: connect, configure, observe, disable, reauth.

**Out of scope:** Klaviyo, Gorgias, Attentive, Recharge, LoyaltyLion, Postscript (post-launch staged rollout).

**Inputs needed:** UI design from PDF for integrations module.

**Bundling:** Two internal sub-bundles.
- 11.1: Integration framework + integrations module UI
- 11.2: Meta Pixel + GA4 + review provider finalization

**Acceptance:**
- Connect Meta Pixel via Pixel ID → events fire to Meta in Events Manager
- Connect GA4 via Measurement ID + API secret → events fire to GA4 with custom dimensions
- Review provider: reviews flow into product knowledge record, surface in chat where relevant
- Integration framework: dummy 6th integration scaffolded against framework quickly to verify the post-launch addition speed

**Milestone trigger: Launch-ready.** Public app store submission proceeds.

---

## Phase 12 — UI Pass 2 (designed v1) + multi-mode polish + Settings + Super Admin

**Goal:** All surfaces match the PDF design spec. Multi-mode show/hide complete across all modules. Settings module polished. Super Admin (internal-facing, low-polish acceptable) functional.

**Scope:**
- UI Pass 2: rebuild every surface against PDF design. Tokens swap, components polish, layouts conform. No new functionality — pure design implementation.
- Multi-mode dashboard polish: every section has correct show/hide for FASHION/ELECTRONICS/BEAUTY/FURNITURE/GENERAL. Section repurposing implemented (e.g. "Style Quiz Results" → "Configurator Responses" for furniture).
- Settings module polish: branding, retention controls, exports, GDPR controls, user prefs, integration settings link
- Super Admin (internal): view all merchants, enable/disable, basic logs viewer (errors only, last 7 days). Functional only — not styled to spec since only the team uses it.
- Mobile-responsive audit across embed app + portal + storefront
- Accessibility audit: WCAG AA on embed app (Polaris), portal (shadcn — verify), storefront chat widget (manual fixes)

**Out of scope:** Super Admin polish (post-launch, year 2). Dynamic store types creation (post-launch — hardcoded modes for v1). Support ticket system in-app (use Intercom or external for v1).

**Inputs needed:** PDF design (already in repo).

**Bundling:** Three internal sub-bundles.
- 12.1: UI Pass 2 across embed app + portal merchant-facing surfaces
- 12.2: UI Pass 2 storefront + multi-mode polish
- 12.3: Settings module + Super Admin minimal + mobile + a11y audits

**Acceptance:**
- Side-by-side spot check: 8 random screens vs. PDF → match within design-token tolerance
- Switching `storeMode` in dev → entire portal reflows correctly across all 5 modes
- Lighthouse 90+ on portal dashboard + chat widget
- WCAG AA pass on Polaris (embed) + shadcn (portal); manual a11y issues on storefront chat widget logged + closed

**Cut-list option:** Cut Phase 12 to merchant-facing only (storefront stays at v0; ship Pass 2 storefront post-launch).

---

## Phase 13 — Compliance + App Store submission

### MILESTONE: App Store approved.

**Goal:** Shopify App Store submission. GDPR fully compliant. Performance budgets enforced. Localization scaffolding tested. Security hardening verified.

**Scope:**
- GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact` — handlers + verification
- Privacy policy + Data Processing Agreement
- Performance budgets enforced: embed app <2s cold + <800ms warm, theme extension <50ms render + <200KB JS, portal Lighthouse 90+, worker 50 products/min sustained
- Mobile testing: every customer-facing surface verified on real mobile devices (iOS Safari, Android Chrome)
- Localization scaffolding tested: add a fake "Spanish" locale → verify all strings flow through i18n layer with no hardcoded text
- Security hardening: OAuth scopes audited (read-only where possible), webhook HMAC validation verified on every receiver, secrets rotation cadence set (quarterly), database role separation verified, no PII in logs
- App Store submission package: app listing copy, screenshots, demo video, support contact, pricing copy
- Submission to Shopify App Store
- Review iteration (Shopify reviewers may request changes)

**Out of scope:** Multi-region deployment (post-launch as needed). Advanced security (SOC 2 — post-launch as enterprise prospects emerge).

**Inputs needed:** App Store listing copy + screenshots + demo video (Phase 13 produces).

**Bundling:** Two internal sub-bundles.
- 13.1: GDPR + privacy + performance + mobile + a11y final audit
- 13.2: Security hardening + App Store package + submission + review iteration

**Acceptance:**
- All GDPR webhooks tested with simulated requests → correct data export / deletion behavior
- Performance budgets verified with Lighthouse + manual mobile testing
- App Store listing submitted; Shopify reviewers respond; any feedback addressed; app approved
- Public launch day-of checklist signed off

**Milestone trigger: App Store approved.** Public launch.

---

## State of the codebase (running inventory)

This section is the truth-of-the-moment for what's actually in the repo and live in production. Update at the close of every phase.

### Surface architecture

AI Stylist ships across three surfaces, each with a distinct purpose:

- **Embed app** (Shopify admin, Polaris, App Bridge): merchant onboarding and configuration only. Store type selection, feature toggles, CTA placement, plus an "Open Dashboard" handoff button to the portal.
- **SaaS portal** (separate Next.js app, separate Railway service, shadcn + Tailwind, App Bridge SSO): everything substantive. Dashboard Overview, Customer Profile, AI Agents config, Conversations, Quiz Builder, Lookbook, Knowledge Base, Analytics, Settings, and the tagging review UI. Stood up in Phase 4.
- **Storefront chat widget** (theme app extension): the buyer-facing surface. Floating chat widget + dynamic CTA near Add-to-Cart.

This split is enforced architecturally — the portal is a separate Railway service with shared Postgres but role-separated connection pool. Polaris-styled review UI in the embed app would be throwaway code; the review surface belongs in the portal where the rest of the merchant-facing dashboard lives.

The system is multi-mode by design (FASHION/ELECTRONICS/FURNITURE/BEAUTY/GENERAL), with mode-specific behavior gated on the merchant's storeMode selection during embed-app onboarding. Phase 2's vocabulary calibration was FASHION-only based on dev-catalog evidence; non-FASHION modes await calibration per the multi-mode vocabulary asymmetry debt item.

**Production-live (Railway, web service):**
- Existing chat widget + theme app extension (shipped through 12d)
- Recommendation tool: `recommend_products` + `search_products` (current implementation, embed-and-match wrapper, will be replaced in Phase 3)
- 2,632 dev-store products fully ingested into rich knowledge record (PR-B); embeddings still on the old (title + desc + tags) record awaiting Phase 3 re-embed
- Voyage embedding integration + pgvector retrieval
- Shopify Admin + Storefront API auth; **18 webhook subscriptions live** (PR-C): products/{create,update,delete}, collections/{create,update,delete}, inventory_levels/update, customers/{create,update,delete}, orders/{create,updated,cancelled}, plus app/uninstalled, app/scopes_update, customers/data_request, customers/redact, shop/redact
- Webhook handlers (PR-C + PR-C.5 + PR-D): products thin (HMAC + stale-write check + DELTA enqueue + 200 — worker is sole authoritative writer for full Product column set); collections stale-write-checked + DELTA enqueue; inventory direct narrow upsert; customers/* now write `CustomerProfile` rows in real time (PR-D D.1 thickening + GDPR redact helper); orders/* still log-only stubs awaiting Phase 3 ingest pipeline
- CustomerProfile schema (PR-D D.1): 4 new models (`CustomerProfile`, `CustomerProfileAttribute`, `CustomerSession`, `CustomerEvent`), 1 enum (`CustomerEventKind`), 4 column additions. Backfill script + verifier shipped in D.3; verified on dev shop 2026-05-03 (3 customers, 0 orders in 90d window, OVERALL PASS)
- In-worker daily cron tick (PR-D D.2): tick loop fires every minute, resolves each shop's `MerchantConfig.timezone` at tick time, enqueues DELTA at 03:00 in merchant timezone, writes `CatalogSyncJob.triggerSource='CRON'`. Force-tick + natural-tick verified in production 2026-05-01.
- `enqueueDeltaForShop` shared helper (PR-C) collapses webhook bursts into one QUEUED DELTA per shop (QUEUED-only dedup; correctness-preserving against mid-fetch edits)
- Re-auth banner in embedded admin shell (PR-C) with `write_X ⇒ read_X` implication
- DB-backed `CatalogSyncJob` schema + library (PR-A); cursorAt columns added (PR-C C.1)
- Tagging engine (PR-2.1 + PR-2.2): DB-backed `TaggingJob` queue with QUEUED-only dedup + INITIAL_BACKFILL singleton (partial unique indexes); review state machine on `ProductTag` (`status` enum PENDING_REVIEW/APPROVED/REJECTED, `reviewedAt`, `reviewedBy`); dual-budget cost ledger ($0.005/product / $0.50/shop/day / $10/backfill, env-tunable via three `TAGGING_*` vars); MerchantConfig budget tripwires (`taggingBudgetWarnedAt`/`taggingBudgetExceededAt`); model `claude-sonnet-4-6`; rule-engine writes APPROVED, AI writes PENDING_REVIEW; orthogonal `computeTagStatusFull` source × status matrix in `tag-status.ts`. Triggers: PRODUCTS_CREATE webhook + DELTA hash-change + manual retag endpoint + per-tag review endpoint.
- INITIAL_BACKFILL handler (PR-2.2-mech): cursor-resume + mid-run budget check + per-product failure isolation. Live in worker. Verified end-to-end via n=50 limited backfill on 2026-05-04 (50/50 products, $0.3502 total, 3.0 min wall-clock).
- Kickoff script `scripts/start-fashion-backfill.mjs` (PR-2.2-mech): `--shop` required, `--limit N`, `--force`, `--skip-confirm`. Runtime cost projection from sampled description-length distribution × cost-per-Kc anchor (recalibrated to $0.0032/Kc at PR-2.2-mech.4).
- Reporter script `scripts/report-backfill.ts` (TS-converted at PR-2.2-mech.3): six closure-evidence artifacts. Vocabulary classification imports STARTER_AXES + AXIS_OPTIONS from canonical TS source-of-truth (run via `npx tsx`).
- FASHION vocabulary at PR-2.2 close: 16 axes (PR-2.1 baseline 11 + PR-2.2-mech.1 sustainability + season + PR-2.2-mech.4 sleeve_length + pattern + collar_type). Schema-validation comments on non-FASHION modes (PR-2.2-mech) document "validated as-is, no production exposure yet."
- `axesStillNeeded` filter in `rule-engine.server.ts` (PR-2.2-mech.2): two-set split — `axesWithExistingValue` (status-agnostic) for rule-write filter, `axesWithStickyValue` (APPROVED + REJECTED only) for AI prompt gating. PENDING_REVIEW tags are replaceable on re-tag.
- Old in-memory `batch_tag` route silently routes through the new queue since PR-2.1 (deprecated; cleanup deferred to a future maintenance commit, Phase 4 portal work or earlier).

**Production-live (Railway, worker service):** Live since PR-B (`2011028`). Cursor age probe instrumented in PRODUCTS + COLLECTIONS phases (PR-C C.3); no real values yet because DELTA path uses `updated_at:>=` filter, not saved cursors. **Tagging poll loop (PR-2.1):** runs in same process as catalog sync claim loop, independent poll interval (2-5s) + independent heartbeat clock. Boot-event `tagging_loop_started` emitted at startup (PR-2.1 follow-up `ca4d4cd`). Heartbeat independence verified end-to-end during smoke S7.

**Repo docs:**
- `docs/recommendation-engine-brief.md` (v0.3, commit `22e849c`) — north star
- `docs/scope-decisions.md` (commit `616fe70`) — locked product decisions
- `docs/ui-design-stylemate-v1.pdf` (commit `616fe70`) — UI source of truth
- `docs/claude-execution-rules.md` (commit `9ecd0ad`) — Claude Code execution rules
- `CLAUDE.md` (commit `9ecd0ad`) — Claude Code reading order + operational notes
- `HANDOFF.md` (this file)

**Key operational debt:**
- Migration discipline (see CLAUDE.md): no `prisma migrate dev` ever. Migrations applied only on Railway deploy. PR-A advisory lock incident root cause now structurally prevented.
- Cursor TTL anomaly first observed during PR-B testing (cursors went stale during ~70s container restart in 2/5 graceful-shutdown tests). Status moved from "to investigate" to "monitoring — instrumentation in place" via PR-C C.3 cursor age probe. First real `cursorAgeMs` values surface on the next MANUAL_RESYNC, INITIAL run, or stuck-job resume.
- **`lastKnowledgeSyncAt` is an attempt-time signal, not a content-change signal.** It advances on every DELTA drain regardless of whether the hash changed. Use `knowledgeContentHashAt` for content-change-time queries. This is a documentation contract for downstream consumers, not a schema gap.
- **`upsertNormalizedProduct` is unused on the products-webhook DELTA path** but stays defined in `app/lib/catalog/upsert.server.ts`. PR-D's cron path uses `upsertProductKnowledge` (single-writer architecture preserved). Consider removing the dead function in a small cleanup commit after the next consumer audit confirms no callers.
- 2,632 dev-store products need re-embedding against new richer record once Phase 3 lands. Re-embed cadence decision deferred to Phase 3 planning.
- **pgvector IVFFlat indexes are unmodellable in Prisma DSL.** `prisma migrate diff` will permanently report drift on `Product_embedding_cosine_idx` (Prisma sees the index in the live DB, doesn't see it in the schema, and emits a `DROP`). Accepting that DROP would silently destroy the embedding retrieval index — Phase 3's vector search would degrade to sequential scan over 2,632 products on every recommendation call. **Discipline:** always inspect `migrate diff` output before applying any migration; expect IVFFlat drift to remain present indefinitely; hand-edit migration SQL to omit any IVFFlat-related `DROP` statements. The D.1 migration in PR-D documents this pattern in a comment for future maintainers. Possible future cleanup: use Prisma's raw migration support to add the IVFFlat index back to `schema.prisma` via a manually-applied SQL fragment so future diffs are clean — out of scope until Phase 3 embedding work resumes.
- **Pre-existing TypeScript error at `app/routes/app.config.tsx:280`.** `error TS2322 — Property 'type' does not exist on type 'Omit<ReactProps$4, "accessory"> & ReactBaseElementProps<TextField>'`. First surfaced explicitly in D.3's typecheck artifact (`npm run typecheck` exit 2). Confirmed not a D.3 regression via stash-and-rerun on clean HEAD (`3e8d3fb`): same single error. Likely cause: Polaris API has changed `TextField` input type accessor; the form input handler at `app.config.tsx:280` needs to use the new shape. **Fix path:** small follow-up commit, not blocking. Will be addressed before any portal work in Phase 4 touches the config route, or before merchant-onboarding-flow changes in the embed app, whichever comes first. PR-2.1 typecheck baseline preserved (1 error pre, 1 error post — captured at `.pr-2-1-artifacts/typecheck.txt`); all five PR-2.2 mechanical commits also preserved the baseline.
- **Per-merchant backfill budget.** `TAGGING_BACKFILL_BUDGET_USD_MICROS` is currently a global env var (default $10). Needs to ride on `MerchantConfig` (or `PlanConfig` in Phase 10) before any production merchant with a substantial catalog onboards. The dev shop's $10 default has 96.5% headroom on the n=50 run, but that's on a 1,169-product catalog; a 50,000-product merchant at $0.007/product mean would hit ~$350 — 35x the global cap. Surfaced at PR-2.2-mech (anticipated) and reconfirmed by PR-2.2-mech.4's recalibration (the new $0.0032/Kc anchor projects ~$5-8 for full dev catalog; production scale is the gap).
- **Per-product cost cap unwired.** `TAGGING_COST_PER_PRODUCT_USD_MICROS` env var exists, has a `getPerProductCapMicros()` getter in `tagging-cost.server.ts`, but no caller invokes it. `.env.example` documents this explicitly ("STATUS: informational target only. NOT enforced pre-call."). Aggregate caps (per-shop daily + backfill) are the actual enforcement gates. **Decision:** either wire the cap (pre-call estimation from description length + reject if projected cost exceeds cap) or remove the env var as dead code. Deferred to a future maintenance commit (Phase 4 portal scaffold work or earlier).
- **Dual-guard for REJECTED axes is redundant.** Discovered during PR-2.2-mech.2's bug fix. `applyRules`'s `axesStillNeeded` filter blocks the WHOLE axis when any REJECTED tag exists (axis-level). `ai-tagger.server.ts`'s `rejectedValuesByAxis` prompt-payload field would block only the specific (axis, value) pair (value-level). The axis-level filter wins because the AI never sees the axis in `starterAxes`; the value-level guard is dead code in practice. **Right semantic is probably value-level** — merchant rejected `occasion=brunch` should not block the AI from proposing `occasion=casual` on the same product. Requires evidence from the merchant review UI (Phase 4 portal scaffold) before changing; PR-2.2-mech.2 captured the finding and pinned the current axis-level behavior with a regression test.
- **TaggingJob.summary key naming inconsistency.** Discovered during PR-2.2-mech.4 verification. The handler writes `totalProducts` to `summary` but `processedProducts` and `failedProducts` are written to top-level columns (not summary keys). Operational SQL queries that try `summary->>'processedProducts'` get NULL. **Decision:** the actual operational truth is — counts on top-level columns (`processedProducts`, `failedProducts`, `totalProducts`); summary carries `outcome`, `lastProcessedProductId`, `errorCounts`, `kind`, `startedAt`, `completedAt`, `limit`, `kickoffMeanChars`, `projectedTotalUsd`, `projectedPerProductUsd`, `kickoffActiveCount`. Documenting here in HANDOFF as the canonical schema until a future commit aligns the handler's writes (or until `.summary`'s shape becomes part of a typed contract on `TaggingJob`).
- **Surface architecture drift in PR-2.2 close planning.** The original close prompt placed the tagging review UI in the embed app instead of the portal. Caught before the wrong scope shipped to canonical HANDOFF. Re-anchored before commit. HANDOFF now carries an explicit Surface Architecture subsection at the top of "State of the codebase" to prevent recurrence in future planning rounds: embed app for onboarding only, portal for substantive merchant-facing UI (stood up in Phase 4), storefront for buyer-facing.
- **Multi-mode vocabulary asymmetry.** FASHION has 16 axes calibrated against n=50 real-catalog evidence (PR-2.2-mech.1 and PR-2.2-mech.4 grounded in dev-shop tagging output). ELECTRONICS, FURNITURE, BEAUTY, and GENERAL have seed vocabulary only — never calibrated against real merchant data because no test catalog exists for those modes. The architecture supports multi-mode (`STARTER_AXES`, `AXIS_OPTIONS`, prompt construction, and reporter classifier are all mode-aware), but the AI's prompt for non-FASHION modes will have lighter axis coverage and may propose more out-of-vocabulary axes during initial tagging. **Resolution:** calibrate non-FASHION vocabularies in Phase 5 (per-mode re-ranker work) using the same evidence-driven loop PR-2.2 used for FASHION, OR earlier if a non-FASHION merchant onboards before Phase 5. Phase 3 (pipeline rewrite) operates on FASHION-only because that's the dev catalog; the pipeline architecture itself is mode-agnostic and ports to other modes when calibration data arrives.
- ~~**Boot-event observability gap in `worker-tagging.ts:startTaggingLoop`.**~~ **RESOLVED at `ca4d4cd` (2026-05-03).** On a clean post-deploy state with zero TaggingJob rows, the tagging loop emitted no log line during boot because the existing `tagging boot sweep complete` event was conditional on `swept.resumedJobIds.length > 0`. Identified during PR-2.1 smoke pre-flight (CHECK 2). Fix added a single unconditional `log.info("tagging loop starting", { event: "tagging_loop_started", pollIntervalMs: ... })` call at the entry of `startTaggingLoop`. Verified post-deploy at 2026-05-03T09:49:14.090Z.
- **TaggingJob is also the embedding queue (PR-3.1-mech.1, naming debt).** PR-3.1-mech.1 added `RE_EMBED` to `TaggingJobKind` so the existing TaggingJob queue (cost ledger via `costUsdMicros: BigInt`, heartbeat, dedup partial unique indexes, error class taxonomy, `triggerSource` free-string) doubles as the embedding queue. The model name is now a misnomer relative to its data shape — it covers both Anthropic tagging calls and Voyage embedding calls. Renaming to e.g. `LLMJob` / `AIJob` is a future cleanup (Phase 5+ when other-mode re-rankers ship), NOT 3.1 scope. The structural reuse is correct: the cost-priced LLM-style API queue shape fits both Voyage and Anthropic exactly. Documenting here so future contributors don't add a parallel `EmbeddingJob` model — extend `TaggingJob`'s kind enum instead.
- **Dev catalog count clarification (PR-3.1-mech.1).** Pre-PR-B references in older HANDOFF notes ("1,169 dev-store products") were the production-live filtered count, not the total. PR-B's INITIAL backfill processed **2,632 products / 2,632 / 0 failures / 1m 46s** (HANDOFF:120), and that's the authoritative count. Subtlety: `recommend_products` operates on a buyable subset (status=ACTIVE + recommendationExcluded=false + variants.availableForSale=true), but Drafts can flip to Active mid-session and embeddings cover all 2,632 rows. PR-3.1.5's bulk re-embed pass projects against 2,632 (~$0.08 Voyage cost at voyage-3 list price), not 1,169. The 3.1.5 execution prompt should reference 2,632.
- **Voyage pricing date discipline (PR-3.1-mech.1).** When `app/lib/embeddings/voyage-cost.server.ts` lands in mech.6, the per-Mtok price constant must carry a comment in the form `// sourced from voyageai.com on <YYYY-MM-DD>` so future price changes are observable to anyone reading the file. Same discipline as the Anthropic tagging cost ledger comment in `app/lib/catalog/tagging-cost.server.ts:1` (model rates header). The cost ledger column is shared (`TaggingJob.costUsdMicros`) so price-change auditability is the only mechanism we have for catching silent model-pricing drift.
- **Stale dev-shop offline session token.** Length-38 stored value (atypical — Shopify offline tokens normally land as `shpat_` + 32 hex; the stored token lacks the prefix indicating raw token storage), expired `2026-05-03T01:37:21Z`, rejected by Shopify Admin API with `[API] Invalid API key or access token (unrecognized login or wrong password)`. Surfaced during PR-2.1 smoke S2 when the runner attempted a programmatic `productUpdate` mutation to trigger the tagging chain. Blocks programmatic Shopify Admin API access from local scripts. **Webhook delivery to deployed worker is unaffected** — smoke S3+ confirmed end-to-end via manual user-edit trigger. Refresh requires re-OAuth via the embed app surface — NOT Phase 2 scope, NOT PR-2.1's responsibility, but tracked here for whoever owns operations to address before any future PR needs programmatic Shopify mutations from a script.

**Risks closed during PR-C / PR-C.5:**
- Webhook subscription registration timing (Risk 1 from PR-C planning) — empirically resolved via Addition 1.
- Dedup correctness under burst (Risk 2 from PR-C planning) — empirically resolved via Addition 3 (5 calls → 1 fresh + 4 deduped).
- Shopify protected-data dev-mode access (was blocking customers/* and orders/* subscription registration) — closed when dev-mode access activated in Partners between `cd60315` and `9475119`. **Note for first-merchant onboarding:** production-review submission for non-dev merchants is still required and is an open task surfaced when we approach soft-launch — not addressed in PR-C.
- **Two-writer race (R-C.1): CLOSED structurally by PR-C.5 (`1eda3c2`).** Webhook handlers no longer write Product columns directly; the worker is the sole authoritative writer on the DELTA path. End-to-end verification on `100-pure-linen-fabric-gift-box` confirmed the three timestamps (`syncedAt`, `lastKnowledgeSyncAt`, `knowledgeContentHashAt`) collapse to a single instant. The transient stale-hash window observed during the C.2 first-attempt regression is gone.

---

## Bundling discipline (rules of thumb)

**Bundle within phases when:**
- Multiple sub-tasks share a data model (e.g. customer profile schema + bulk fetch + initial backfill)
- Multiple sub-tasks share a UI surface (e.g. all conversations module screens)
- Sub-tasks are mechanical extensions of each other (e.g. webhook handlers — same validation + enqueue pattern, 12 of them)
- Sub-tasks would create deploy gaps if shipped separately (e.g. schema + library + route migration must ship together)

**Don't bundle across:**
- Architectural seams (data layer + UI + pipeline in one shot — never)
- Different services (web service + worker service — separate PRs)
- Different surfaces (embed app + storefront + portal — separate PRs)
- Different review/risk profiles (security-sensitive + UI polish — separate PRs)

**Plan-then-execute per phase:**
- Planning prompt for Claude Code → plan returns → I review → execution prompt → Claude Code executes → commit/push/Railway deploy/verify cycle
- Within a phase, Claude Code may produce 2-3 commits (one per sub-bundle). Each commit goes through commit/push/verify. No multi-commit single-shot.
- The plan itself can describe multiple sub-bundles; the execution prompt sequences them.

---

## Open product decisions (resolve as phases land)

Most resolved by scope-decisions. Five new ones from brief v0.3 §17 sit at specific phases:

- **Re-embed cadence after Phase 1:** decided in Phase 3 planning
- **Body-type model provider:** decided in Phase 9 planning (recommendation: LLM-with-vision for v1)
- **Conversation export format:** decided in Phase 5 by first soft-launch merchant feedback (default CSV)
- **Lookbook PDF library:** decided in Phase 7 (recommendation: react-pdf)
- **Stripe vs. Shopify Billing API:** decided in Phase 10 (recommendation: Shopify Billing API mandatory for v1, Stripe scaffolded inactive)

Plus three perennials:

- **Tier names + dollar amounts + caps:** decided before Phase 10 ships
- **Brand name finalize:** decided before public launch (one-PR rename via `BRAND_NAME` constant)
- **Review provider (Yotpo vs. Judge.me):** decided at Phase 3 start based on dev-store availability

---

## What this document is not

- A pricing decision. Architecture lands at Phase 10; numbers decide before that phase ships.
- A team plan. Single dev + Claude Code. If team grows, sequencing changes; this document does not.
- A timeline. No calendar, no week numbers. Phases close on acceptance, not on date.
- Frozen. Updated at the close of every phase. Major scope shifts → new HANDOFF version.

---

*Next planning artifact: PR-3.1-mech.2 execution prompt (HARD_FILTER_AXES constant + Stage 1 hard-filters module). Plan locked at PR-3.1 planning round 2026-05-05; sub-bundle 3.1 mech chain runs mech.1 → mech.6 → 3.1 close.*
