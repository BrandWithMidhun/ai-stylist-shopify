# HANDOFF — AI Stylist Shopify App

**Last updated:** 2026-04-28, after brief v0.3 (commit `22e849c`).
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

**Production:** Phase 1 PR-A live (commit `835a801`). Schema layer + DB-backed sync jobs library + route migration shipped. Existing chat works in the storefront. The 1,169 dev-store products are still embedded against the old (title + description + tags) knowledge record. The new richer record (metafields + metaobjects + collections) is unused until PR-B ships and runs the first INITIAL backfill.

**Local:** Brief v0.3 (`22e849c`), Claude Code execution rules + CLAUDE.md update (`9ecd0ad`), full-vision scope decisions + UI PDF (`616fe70`) — all pushed.

**Sync button:** No-op until PR-B. Clicking it queues a `CatalogSyncJob` row in QUEUED state; nothing drains it.

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

## Phase 1 — Knowledge ingestion foundation

**State:** PR-A shipped. PR-B, PR-C, PR-D pending.

**Goal:** Catalog ingestion fully autonomous. Worker drains queued jobs, webhooks trigger DELTA jobs on every relevant change, daily cron catches missed webhooks, all 1,169 dev-store products land in the new richer knowledge record with content hashing in place.

### PR-B — Worker service + first INITIAL backfill

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

### PR-C — Webhook subscriptions + handlers + re-auth banner

**Scope:**
- New webhook subscriptions: `products/create`, `products/update`, `products/delete`, `inventory_levels/update`, `collections/update`, `customers/create`, `customers/update`, `customers/delete`, `orders/create`, `orders/updated`, `orders/cancelled`, plus metafield/metaobject create/update/delete (Shopify-supported subset)
- Webhook handlers: HMAC validate, parse payload, enqueue targeted DELTA `CatalogSyncJob`
- Re-auth UX banner in embed app for existing production installs that pre-date the expanded scope set. New installs already get the right scopes via `shopify.app.toml`. The scope set itself was pulled forward into PR-B (commit 3) — PR-B's first INITIAL backfill could not satisfy its own acceptance criteria without `read_metaobjects`/`read_metaobject_definitions`, and a single re-auth round (vs. two) is strictly better merchant UX. PR-C therefore handles only the re-auth UX path for production installs that haven't yet re-granted; the underlying scope diff is already deployed.
- Stale-write protection on every handler

**Out of scope:** Customer Profile schema (bundled with PR-D below). Order ingest pipeline beyond enqueue (Phase 3).

**Inputs needed:** None.

**Bundling:** Solo PR. Internally bundles all webhook handlers because they share validation/enqueue patterns.

**Acceptance:**
- All 12+ webhook subscriptions registered in Shopify partner dashboard
- HMAC validation rejects forged requests
- Webhook → enqueued DELTA job → worker drains → product knowledge record updated (verified end-to-end with one product edit in dev store)
- Re-auth banner appears for existing installs missing new scopes
- After re-auth, `customers/create` webhook fires when a new customer is added in Shopify admin

### PR-D — Daily delta cron + Customer Profile schema

**Scope:**
- Cron service (Railway cron, or in-worker scheduled trigger — decide in planning)
- Daily DELTA job enqueue at 03:00 in merchant timezone (`MerchantConfig.timezone`)
- Drift summary writes to `CatalogSyncJob.summary` so we can monitor webhook reliability
- Customer Profile schema migration: `CustomerProfile`, `CustomerProfileAttribute` (mode-tagged key/value), `CustomerSession` (anonymous + identified), `CustomerEvent` (append-only behavioral stream)
- Backfill script: bulk-fetch all dev-store customers + last-90-day orders → populate `CustomerProfile` + `CustomerProfileAttribute` + initial `CustomerEvent` rows from order history
- No UI yet — schema only. Customer Profile module UI is Phase 4.

**Out of scope:** Anonymous session merge logic (Phase 5 — needs chat to be wired). Customer profile UI (Phase 4).

**Inputs needed:** None.

**Bundling:** Yes — cron + Customer Profile schema bundled because (a) cron is small and (b) Customer Profile schema must land before any module that depends on it (Conversations Phase 5, Lookbook Phase 7). Doing it now closes the schema dependency early.

**Acceptance:**
- Daily cron runs against dev store at scheduled time, enqueues DELTA, worker drains, drift count logged to summary
- All dev-store customers have `CustomerProfile` rows after backfill (verify count matches Shopify customers count)
- Order-derived `CustomerEvent` rows populated (verify count > 0 for customers with orders)
- Schema diff against the brief §5 schema spec verified column-by-column

**Phase 1 close:** All four PRs landed. Sync system fully autonomous. Customer Profile schema in place. Phase 2 unblocked.

---

## Phase 2 — Catalog intelligence (AI tagging)

**Goal:** AI-tagging engine generates structured tags (occasion, style, formality, color, fit, material, season, etc.) per product, mode-aware, with merchant review/approval. Tagging admin UI in embed app — functional v0, Polaris.

**Scope:**
- Tagging engine: LLM-orchestrated against product knowledge record (title + description + image URLs + existing metafields). Mode-specific tag schemas (FASHION different from ELECTRONICS).
- Tags stored as structured columns on `Product` (not free-text), so they're filterable in Stage 1 of the pipeline.
- Re-tag triggers: new product, knowledge record change, manual merchant retag.
- Review queue UI in embed app: pending tags, approved tags, rejected tags. Bulk approve/reject. Per-product edit.
- Tagging cost budget (env var, default $0.005/product). Hard cap with merchant warning.
- First-pass tag all 1,169 dev-store products against the new knowledge record.

**Out of scope:** Pipeline integration (Phase 3 — pipeline reads tags as Stage 1 + Stage 3 input). Reviews + blogs ingest (Phase 4). UI Pass 2 polish (Phase 12).

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

---

## Phase 3 — Pipeline rewrite + reviews + order ingest + AI attribution

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
- 3.1: Pipeline stages 1-6 + re-embed
- 3.2: Review provider + order ingest + sales velocity
- 3.3: Attribution writes + reconciliation + audit trail

**Acceptance:**
- "Show me best sellers" returns actual top-selling dev-store products from order data, not vibes
- "Show me daily wear shirts" returns shirts with style=daily, formality=casual — not festive kurtas (the v0.2 misfire example)
- OOS handling: high-relevance OOS product flagged, near-substitute shown — not "may have sold out" hand-wavy reply
- Reviews-derived signal verifiable: a product with mostly-positive reviews + good fit feedback ranks above an equivalent product with bad reviews
- Attribution: place a test order in dev store after a chat session that recommended a product → verify `AttributionEvent` row exists with full trace → click trace → see exactly which `recommend_products` call led to it

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

**Production-live (Railway, web service):**
- Existing chat widget + theme app extension (shipped through 12d)
- Recommendation tool: `recommend_products` + `search_products` (current implementation, embed-and-match wrapper, will be replaced in Phase 3)
- 1,169 dev-store products embedded against old (title + desc + tags) record
- Voyage embedding integration + pgvector retrieval
- Shopify Admin + Storefront API auth, webhooks for products + collections (basic set)
- DB-backed `CatalogSyncJob` schema + library (PR-A)
- Existing in-memory `batch_tag` job kind (Phase 2's domain, untouched by PR-A)

**Production-live (Railway, worker service):** Not yet — created in PR-B.

**Repo docs:**
- `docs/recommendation-engine-brief.md` (v0.3, commit `22e849c`) — north star
- `docs/scope-decisions.md` (commit `616fe70`) — locked product decisions
- `docs/ui-design-stylemate-v1.pdf` (commit `616fe70`) — UI source of truth
- `docs/claude-execution-rules.md` (commit `9ecd0ad`) — Claude Code execution rules
- `CLAUDE.md` (commit `9ecd0ad`) — Claude Code reading order + operational notes
- `HANDOFF.md` (this file)

**Key operational debt:**
- Migration discipline (see CLAUDE.md): no `prisma migrate dev` ever. Migrations applied only on Railway deploy. PR-A advisory lock incident root cause now structurally prevented.
- 1,169 dev-store products need re-embedding against new richer record once Phase 3 lands. Re-embed cadence decision deferred to Phase 3 planning.

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

*Next planning artifact: PR-B planning prompt for Claude Code — worker service + first INITIAL backfill.*
