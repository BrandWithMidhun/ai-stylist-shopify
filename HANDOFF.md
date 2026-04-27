# HANDOFF — AI Stylist Shopify App

**Last updated:** 2026-04-27, end of session that shipped 12d and wrote the recommendation engine brief.
**Supersedes:** Earlier HANDOFF state from end of 12c (commit `ff6f1ce`).
**North star:** `docs/recommendation-engine-brief.md` (commit `e03c97d`). Read it before any phase work. The brief governs all recommendation- and UI-touching decisions.

---

## Where we are

12c shipped semantic retrieval (Voyage + pgvector) yesterday. 12d shipped today and closes a small but important set of bugs and prompt fixes:

- Variant ordering on product cards now prefers available variants
- `tags` parameter removed from `search_products` (taste intent now exclusively goes through `recommend_products`)
- `topDistance` surfaced in `recommend_products` tool result for fallback decisions
- System prompt's tool-selection guidance tightened, with an explicit fallback rule when `topDistance > 0.8`

Production logs verified all four behaviors live. Tool-selection behaving correctly across taste, vibe, and literal-keyword queries — three different correct selections observed.

During testing we identified two real product gaps that don't fit the old roadmap:

1. The recommendation quality misfires on non-fashion intents. A festive kurta got recommended for "daily wear." Today's `recommend_products` is a thin embed-and-match wrapper; it has no structured filtering, no mode awareness, no merchant-curated signal injection.
2. Out-of-stock UX is misleading — agent says "may have sold out or been removed" when it's actually sold out, and doesn't offer alternatives.

Both led to the architecture brief, which is the new foundation. Yesterday's 12-day launch plan is replaced by a 6-8 week plan that ships the brief.

---

## Sequenced phases

The brief's Week 1-8 sequence is broken into concrete phases below. Each phase has scope, inputs needed, bundling notes, and acceptance criteria. **Plan-then-execute per phase. Bundle within phases where mechanical and topically tight. Don't combine across architectural seams.**

Phases are numbered against the new architecture, not the old roadmap. The old phase numbers (010, 12e, 12f, 13, 13b) are absorbed and noted where relevant.

---

### Phase 1 — Knowledge ingestion foundation
**Maps to:** Brief §2 (data sources) + §3 (sync) + Week 1 of §9.
**Absorbs:** Phase 12b.5 from old roadmap.
**Bundling:** Solo phase. Architecture-heavy. New schema + new webhook subscriptions + new sync code. Do not combine with Phase 2.

**Scope (in):**
- Database schema for the unified product knowledge record (extend `Product`, add new tables for metafield values, metaobject references, collection memberships, full cleaned descriptionHtml)
- GraphQL queries to pull metafields (all namespaces), metaobjects, collections per product
- Webhook subscriptions: `products/update`, `products/delete`, `collections/update`, `collections/delete`, `metafields/update`, `metafields/delete`
- Catch-up cron (Railway) for missed webhooks, daily
- Initial backfill script: ingest the dev store's 1169 products with the new richer record
- Content hashing: skip re-embedding when product knowledge content is unchanged

**Scope (out):**
- AI tagging (Phase 2)
- Embedding pipeline changes (Phase 3)
- Reviews and blogs (Phase 4)
- Any UI work

**Inputs needed before starting:**
- None blocking. We have the dev store, the schema authority, and webhook permission scopes already.

**Acceptance:**
- All 1169 dev store products have a complete knowledge record (metafields, metaobjects, collections, descriptionHtml) in DB
- Updating a product, collection, or metafield in Shopify admin triggers a webhook within 30s and our DB row reflects the change
- Catch-up cron runs daily and reports drift count (should be 0 in steady state)
- Re-embedding is skipped when content hash is unchanged (verify via log)

**Estimated effort:** 2-3 phase iterations.

---

### Phase 2 — AI tagging engine + functional tagging admin UI
**Maps to:** Brief §2 (AI-derived tags) + §7 (admin tagging UI) + Week 2 of §9.
**Absorbs:** Phase 13 + Phase 13b from old roadmap.
**Bundling:** Bundle the AI tagging engine and the v0 admin UI together. They're tightly coupled — the UI exists to operate on what the engine produces. Functional v0 only; design polish in Phase 9.

**Scope (in):**
- AI tagging service: per-product Claude (Haiku) call that takes the unified knowledge record and emits structured tags (occasion, formality, gift-suitability, color family, target customer, vibe descriptors, mode-specific facets per the brief's mode awareness)
- New `ProductAiTag` table separate from merchant-assigned `ProductTag`
- Batched re-tagging on initial ingestion + on source product change + 90-day refresh cycle
- Admin page: browse products, see AI tags side-by-side with merchant tags, approve/edit/reject per product, bulk-edit by collection or productType
- Admin page: configure which metafields should be treated as hard filters (used by Phase 3 Stage 2), which collections should boost (used by Phase 3 Stage 5)
- All admin UI in functional v0 (Polaris defaults; no design polish)

**Scope (out):**
- Pipeline rewrite (Phase 3)
- Reviews/blogs (Phase 4)
- Designed UI pass (Phase 9)

**Inputs needed before starting:**
- Phase 1 complete (AI tagging needs the rich knowledge record as input)
- A short prompt-engineering pass to define the AI tagging schema per mode — this is part of phase planning, not a blocker

**Acceptance:**
- Every dev store product has AI tags after a backfill run, costing under $5 total for 1169 products
- Admin UI lets merchant approve/edit/bulk-edit tags and the changes persist
- Hard-filter metafield config is editable in admin and reads correctly in DB
- Bulk operations on 100+ products complete in under 10s

**Estimated effort:** 3-4 phase iterations (engine + admin UI + bulk ops).

---

### Phase 3 — Pipeline rewrite (six-stage engine, FASHION mode)
**Maps to:** Brief §4 (the pipeline) + §5 (mode awareness) + Week 3 of §9.
**Absorbs:** Phase 12e (OOS UX is now Stage 2 of the pipeline) + Phase 12f (this is the work itself).
**Bundling:** Solo phase. The pipeline is the engine — its quality determines everything downstream. Do not combine with anything.

**Scope (in):**
- Stage 1: structured intent extraction (Claude returns intent object, not prose blob)
- Stage 2: hard filtering (Postgres-backed, indexed, fast, includes OOS exclusion + similar-but-OOS messaging hook)
- Stage 3: semantic candidate retrieval (existing pgvector flow, now operating on narrowed pool)
- Stage 4: FASHION re-ranker (TypeScript module, weights candidates by style coherence, occasion fit, color match)
- Stage 5: merchant signal injection (boost flagged hero products, featured collections, recent bestsellers)
- Stage 6: diversity and presentation (spread across price tiers and sub-categories)
- Replace `recommend_products` tool with the new pipeline
- New tool result shape: structured intent echoed back, stages traced for debugging

**Scope (out):**
- Other modes (Phase 5 — JEWELLERY, ELECTRONICS, FURNITURE, BEAUTY, GENERAL)
- Stylist Agent (Phase 7 — builds against this new pipeline)
- Reviews/blogs as input signal (Phase 4)
- Learning loop (Phase 4)

**Inputs needed before starting:**
- Phase 2 complete (pipeline reads from AI tags + hard-filter metafield config)

**Acceptance:**
- The festive-kurta-for-daily-wear regression doesn't reproduce on the dev store
- Stage 2 hard filters reduce the candidate pool before embedding (verify via log)
- Latency budget held: 8s p95 per chat turn, 5s p50
- OOS query like "Harvey Shirt" now returns "sold out, here are similar in-stock options" with actual alternatives
- Each stage is traced in tool result for debugging

**Estimated effort:** 4-6 phase iterations.

---

### Phase 4 — Reviews + blog ingestion + heuristic learning loop
**Maps to:** Brief §2 (behavioral signal, brand context) + §6 (learning loop, v1 heuristic) + Week 4 of §9.
**Bundling:** Bundle reviews + blogs. Both are read-only ingestion of external content. Bundle the heuristic learning loop separately within the same phase if the engine work goes smooth.

**Scope (in):**
- Review app integration: Judge.me, Yotpo, Stamped (start with two, add the third based on dev store input)
- Per-product review text blob with re-embed threshold (5 reviews or 30 days)
- Blog scraper: configurable cadence (default weekly), respect robots.txt, manual re-trigger from admin
- Merchant brand context table: voice signal extracted from blogs/About/FAQ
- Session-level tally tracking: impressions, clicks, cart-adds, purchases per product per shop
- `liftScore` computation with confidence smoothing
- Stage 5 boost weights now include lift score
- Sync status admin page (functional v0): when each source last synced, manual triggers

**Scope (out):**
- Learned re-ranker (post-launch)
- Order sync (separate phase below if needed; behavioral signal here is impressions/clicks/carts, not orders)
- Mode coverage beyond FASHION (Phase 5)

**Inputs needed before starting:**
- Phase 3 complete (need a working pipeline to inject signal into)
- Decision on which review apps to support first — see Open Questions

**Acceptance:**
- Dev store reviews ingested for products that have them
- Blog content from dev store ingested and indexed
- A demo session shows: click on product → cart-add → next session, that product or similar is boosted in recommendations
- Sync status page shows green for every source

**Estimated effort:** 3-4 phase iterations.

---

### Phase 5 — Other modes + agentic checkout + lookbook + brand voice playbook
**Maps to:** Brief §5 (mode awareness across all modes) + §7 (brand voice editor) + Week 5 of §9.
**Bundling:** Three sub-bundles within this phase, sequenced:
- 5a: re-rankers for JEWELLERY, ELECTRONICS, FURNITURE, BEAUTY, GENERAL (each is a small TypeScript module against a shared interface)
- 5b: agentic checkout (Checkout MCP + ECP/Checkout Kit fallback, per Shopify guide Part 2.3)
- 5c: lookbook generator (FASHION) + brand voice playbook editor (admin, functional v0)

These three are independent enough to bundle as one phase but should be planned and executed as three sequential mini-phases within it.

**Scope (in):**
- Mode-specific re-rankers, each with mode-relevant signal weighting (per brief §4 Stage 4)
- Mode-specific intent schema in Stage 1
- Hard filter rules per mode in Stage 2
- Checkout MCP integration: create session, populate buyer/payment, complete purchase via MCP
- ECP fallback for browser handoff
- Checkout Kit fallback for mobile native
- Shop Pay handler integration
- Lookbook generator: outfit collections from FASHION mode recommendations, downloadable
- Brand voice playbook editor: free-text instructions prepended to system prompt at chat time

**Scope (out):**
- Image upload + body type analysis (Phase 6)
- UI design polish (Phase 9)
- Analytics dashboard (Phase 8)

**Inputs needed before starting:**
- Phase 3 complete (re-rankers plug into Stage 4)
- Phase 4 complete (lift score available for re-rankers)
- Order sync should be in progress or planned — agentic checkout writes orders that the learning loop reads

**Acceptance:**
- A jewellery test query returns purity-aware, occasion-aware results
- An electronics test query respects compatibility constraints
- Checkout MCP completes a real test purchase end-to-end on the dev store, with ECP fallback verified for the cases MCP can't handle
- Lookbook downloads as a functional file
- Brand voice instructions visibly change the agent's tone in chat

**Estimated effort:** 6-8 phase iterations across the three sub-bundles.

---

### Phase 6 — Image upload + body type analysis (FASHION)
**Maps to:** Brief §7 (storefront image upload UI) + project spec §8.
**Bundling:** Solo phase. Privacy-sensitive, has its own UX considerations.

**Scope (in):**
- Storefront image upload UI (functional v0): front, back, side photos
- Privacy notice and consent
- Backend: image analysis via Claude vision for body type estimation, size recommendation, fit guidance
- Storage: where images live, retention policy, deletion path
- Integration with user profile so styling agent uses the analysis output

**Scope (out):**
- UI design polish (Phase 9)
- Other modes (this is FASHION-only by design)

**Inputs needed before starting:**
- Phase 5 complete (Stylist Agent benefits from body analysis)
- Privacy decision: how long do we retain images? (default suggestion: delete after analysis, store only the inferred attributes)

**Acceptance:**
- Upload flow works on mobile and desktop
- Analysis returns body type + size recommendation in under 10s
- Images are deleted per retention policy and GDPR webhooks honor the deletion path
- Privacy notice is clear and merchant-customizable

**Estimated effort:** 2-3 phase iterations.

---

### Phase 7 — Stylist Agent (rebuilt against new pipeline)
**Maps to:** Old Phase 010, redefined.
**Bundling:** Solo phase. Agent layer on top of the engine.

**Scope (in):**
- Agent orchestrator routing logic: detect styling intent vs commerce intent vs onboarding intent
- Stylist Agent: generates outfit combinations, suggests pairings, explains style logic, personalizes against profile
- Commerce Agent: handles literal product search, price filters, category browsing (already partially exists in `search_products`; consolidate)
- Intent classifier (currently lives in `prompts.server.ts` implicitly via tool selection — make it explicit)
- Hand-off between agents within a session

**Scope (out):**
- New tool definitions (the engine is already the tooling — this phase orchestrates around it)
- Mode-specific styling logic (re-rankers in Phase 5 cover most of this)

**Inputs needed before starting:**
- Phase 3 + Phase 5 complete (Stylist needs the multi-mode pipeline ready)

**Acceptance:**
- A FASHION query like "build me an outfit for a wedding" produces an outfit (top + bottom + accessory if applicable), not just a list of similar items
- Agent routing demonstrably switches between Stylist and Commerce based on user intent
- Profile + body type analysis informs styling decisions

**Estimated effort:** 3-4 phase iterations.

---

### Phase 8 — Analytics dashboard + GDPR + perf + UI Pass 1
**Maps to:** Brief §7 (analytics + sync status as functional admin) + Week 6 of §9 + project spec §16.
**Bundling:** Three sub-bundles. Analytics is biggest. UI Pass 1 is hygiene-only (no redesign), so it bundles cleanly with whatever ships.

**Scope (in):**
- Analytics dashboard (functional v0): sessions, chat starts/completions, agentic add-to-carts, agentic orders, revenue attributed to AI, top performing products, conversion by agent, quiz drop-off
- GDPR compliance webhooks (likely already shipped per Feature 003 — verify and extend if needed)
- Performance budget enforcement: chat widget JS under 100KB gzipped, theme extension Lighthouse impact near zero
- Mobile pass on storefront chat widget
- Accessibility audit on admin (Polaris does most of it; verify keyboard nav and screen reader)
- UI Pass 1 across all admin and storefront surfaces: copy tightening, layout density, no redesign

**Scope (out):**
- Designed v1 implementation (Phase 9)
- Localization beyond English (revisit post-launch unless dev store is non-English)

**Inputs needed before starting:**
- Phase 7 complete (need real chat data flowing)

**Acceptance:**
- Dashboard shows real numbers from at least one week of dev store usage
- GDPR webhooks tested with mock requests
- Performance budgets verified via Lighthouse on dev store
- A11y audit passes on admin
- UI Pass 1 closes obvious copy/layout issues

**Estimated effort:** 3-4 phase iterations.

---

### Phase 9 — UI Pass 2 (designed v1 implementation)
**Maps to:** Brief §7 (designed v1 UI pass) + Weeks 7-8 of §9.
**Bundling:** Each surface implemented per session, polish round per surface. Bundle within sub-surface (e.g., all admin pages in one mini-phase, all storefront in another).

**Scope (in):**
- Admin: onboarding wizard, configuration page, brand voice editor, sync status, tagging review, analytics dashboard, live activity view
- Storefront: chat widget, CTA, product card, lookbook viewer, image upload, quiz UI, auth/account
- Component library / design tokens consolidated
- Polish round per surface after first implementation

**Scope (out):**
- Any net-new feature work
- Localization expansion

**Inputs needed before starting:**
- Designs delivered (Figma or equivalent)
- All previous phases complete or sufficiently stable that the surfaces designed against won't move

**Acceptance:**
- Every surface in the brief's UI section matches the supplied designs to within a polish-pass tolerance
- A11y still passes after redesign
- Performance budgets still hold after redesign

**Estimated effort:** 4-6 phase iterations.

---

### Phase 10 — App Store submission prep
**Maps to:** Week 8 final days of brief §9.
**Bundling:** Single solo phase. Cross-functional checklist.

**Scope (in):**
- App Store listing copy
- Screenshots (admin + storefront)
- Demo video
- Privacy policy
- Support contact
- App Store review fields per Shopify's submission requirements
- Final review against Shopify App Development guide §1.5 pillars (performance, accessibility, localization, security, mobile, non-deceptive, compliance)
- Submission

**Scope (out):**
- Anything that's not submission paperwork or a pre-submission audit

**Inputs needed before starting:**
- Phase 9 complete
- Merchant agreement: which dev store features as the demo store

**Acceptance:**
- Submission accepted by Shopify
- Listing live or in review

**Estimated effort:** 2-3 phase iterations.

---

## Compliance reminders (non-negotiable for App Store)

These thread through every phase, called out per the project spec §22:

- GDPR webhooks (data request, redact, customer redact) — verify in Phase 8
- Accessibility via Polaris on admin, manual audit on storefront — verify in Phase 8 + Phase 9
- Multi-language scaffolding from day one (every visible string through a translation function) — bake in starting Phase 2
- Mobile-first storefront testing — verify in Phase 8 + Phase 9
- Performance budgets on theme extension — measured starting Phase 8
- Webhook HMAC validation — already shipped, verify on each new webhook subscription added in Phase 1 + Phase 4
- Secret rotation plan — already in place, verify before Phase 10

---

## Open questions to resolve as we go

From the brief §11, with target phase to resolve:

- **Which review apps to support first** — resolve before Phase 4. Default Judge.me + Yotpo unless dev store says otherwise.
- **How aggressive to be with blog scraping** — resolve in Phase 4 planning. Default polite.
- **Brand voice playbook v1 vs v1.1** — resolve in Phase 5 planning. Lean v1.
- **Cross-mode behavior in GENERAL stores** — resolve in Phase 5, sub-bundle 5a. May need an explicit category-picker turn.
- **Design language for storefront** — answered when designs land before Phase 9.
- **Live activity view scope** — resolve in Phase 8. Default off, opt-in toggle.
- **Image retention policy** — resolve before Phase 6. Default delete after analysis.

---

## State of the codebase (relevant facts)

- Repo: `C:\Users\Midhun\Desktop\Projects\ai-stylist`, GitHub `main` branch, auto-deploys to Railway on push
- Production URL: `https://web-production-3b1d7.up.railway.app`
- Database: Postgres on Railway, pgvector enabled, 11 migrations applied
- Embeddings: Voyage paid tier active, VOYAGE_API_KEY set in both local and Railway env
- 1169 of 2632 products embedded (drafts and archived correctly filtered)
- Tools registered: `recommend_products` (semantic, primary), `search_products` (literal-keyword fallback)
- 12d shipped today (commit `9899838`), brief committed today (commit `e03c97d`)
- Pre-existing TS error in `app.config.tsx:280` (Polaris TextField type mismatch) — not blocking
- No test harness for chat tools yet; manual verification only

---

## How phases run, restated

For each phase:

1. I write a planning prompt → you paste it to Claude Code
2. Claude Code returns a plan → you paste it back to me
3. I review, push back where needed, you decide on any open points
4. I write the execution prompt → you paste it to Claude Code
5. Claude Code executes (shift+tab early once first edits look right) → lint, build, commit, push
6. Railway deploys → verify in production logs
7. Move to next phase

Bundle within phases where mechanical and topically tight (like 12d). Don't bundle across architectural seams (don't mix Phase 1 + Phase 2 in one execution).

---

## Next action

Start Phase 1 — Knowledge ingestion foundation. The first artifact owed is the planning prompt for Claude Code.
