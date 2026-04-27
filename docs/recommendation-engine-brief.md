# Recommendation Engine + UI Architecture Brief

**Status:** v0.2 — written 2026-04-27, before Phase 010 restart. Supersedes v0.1.
**Purpose:** A north star for every recommendation- and UI-touching decision from now until launch. Not a build spec — a thesis and an architecture that the next ~12 phases develop against.

---

## 1. Thesis

The recommendation engine is the product. The chat widget, the CTA, the lookbook, and the analytics dashboard are surfaces over it. If recs are mediocre, none of those surfaces matter — the agent becomes a worse search bar with a friendlier face. If recs are excellent, every surface compounds.

Excellent here has a precise meaning: **recommendations should drive measurable sales lift over the merchant's existing storefront search and category browse.** That is the success metric. Not click-through, not topDistance, not session length. Conversion lift, attributable to the agent.

To hit that bar across fashion, jewellery, electronics, furniture, beauty, and general stores — and across 200-product boutiques and 50,000-product catalogs — the engine cannot be a single embed-and-match function. It has to be a **living model of each merchant's product and brand knowledge**, refreshed as their data changes, and reasoned against in mode-specific ways.

That is the shape we are building toward.

---

## 2. What the engine ingests

Today the engine sees title + description + Shopify-assigned tags. That is roughly 10% of the signal Shopify and the merchant's site already produce. We need the other 90%.

For every product, we synthesize a **product knowledge record** that combines:

**Shopify-native structured data.** Title, productType, vendor, descriptionHtml (cleaned of HTML), all variants (with their options, prices, inventory), every collection the product belongs to, every metafield value across every namespace (including app-installed ones — review apps, size-guide apps, etc.), every metaobject reference. Collections in particular are high-signal: when a merchant builds a "Daily Edit" or "Bridal Collection" or "Gaming Setup" collection, they are encoding taxonomy by hand. That is data we should respect, not ignore.

**Behavioral signal.** Reviews (text and rating) pulled via the most common review apps (Judge.me, Yotpo, Stamped, Loox, Shopify's native reviews if used). Order history once it's syncing — what this product is bought with, how often, by which kind of customer. Inventory turnover as a proxy for popularity.

**Merchant brand context.** Blog posts on the merchant's online store, scraped by URL pattern (`/blogs/*`). About page, FAQ, lookbooks if structured. The merchant's voice — terse vs effusive, premium vs friendly, traditional vs modern — colors how Claude should talk about the products and what kind of language matches their catalog.

**AI-derived tags.** Once the structured data is ingested, we run Claude over each product to infer additional facets: occasion (daily/festive/wedding/work), formality, gift-suitability, color family, target customer, vibe descriptors. These get stored as our own tag system, separate from the merchant's tags, and become the structured filters the engine uses.

This is the v1 ingestion surface. Everything ships at launch. The cost-effectiveness comes from how we sync it (next section), not from cutting features.

---

## 3. Sync architecture

Source-of-truth gravity is the silent killer here. Shopify is authoritative for structured product data. The merchant's site is authoritative for blog content. Review apps are authoritative for reviews. Each has a different update cadence and different mechanism for staying fresh.

The architecture has to be **event-driven where possible, scheduled where not, and cached aggressively.**

For Shopify-native data: webhooks fire on every product/collection/metafield change. We subscribe and update the corresponding row plus invalidate its embedding. This is already partially built — Phase 12b.5 was scheduled to do the daily catch-up cron for the cases where webhooks miss. We extend it to cover collections and metafields, not just products.

For reviews: most review apps expose webhook or polling APIs. Where webhooks exist, use them. Where not, poll once a day per shop (cheap; review volume is low). Reviews are append-mostly — we don't need to re-embed the whole product when one review lands, we maintain a separate review-text blob per product and only re-embed when it crosses a threshold (e.g. 5 new reviews or 30 days, whichever first).

For blogs and About/FAQ pages: scrape on a configurable cadence (default weekly), with the merchant able to manually trigger a re-scan from admin. Blog content informs **merchant brand context**, which is store-level state, not per-product. So we re-embed once per cadence, not per product.

For AI tags: re-run on initial ingestion, on any change to the source product, and on a 90-day refresh cycle to pick up improved prompts. Each AI-tagging call is cheap (~$0.001 per product on Claude Haiku) but adds up at 50,000 products, so we batch and cache hard.

Cost discipline at the sync layer is what makes "all features live" feasible. The expensive operation is the embedding (Voyage charges per token); the cheap operations are the writes and the AI tags. We embed only on actual content change (compute a content hash; skip if unchanged), and we use Voyage's batching to drop per-call overhead.

---

## 4. The pipeline

A user message arrives. The engine runs six stages, each pluggable per mode:

**Stage 1 — Structured intent extraction.** Claude turns the user message plus the user's quiz profile into a structured intent object, not a prose blob. Required fields, soft fields, hard filters, soft preferences. Example for a fashion query: `{category: "shirt", hard: {gender: "male", availability: true}, soft: {occasion: "daily", style: "minimalist", color_family: ["neutral"]}, free_text: "comfortable"}`. The structured form is what makes everything downstream possible. Today we lose this signal by squashing it into a single `intent` string before retrieval.

**Stage 2 — Hard filtering.** Drop any product that fails a mandatory criterion before scoring anything. Out of stock, wrong gender, wrong room, incompatible with the user's stated device, outside budget. Hard filters are mode-specific and merchant-extensible (a merchant should be able to mark a metafield as "this is a hard filter for my catalog"). This stage is fast — a Postgres query against indexed columns — and dramatically narrows the candidate pool, which keeps the rest of the pipeline cheap.

**Stage 3 — Semantic candidate retrieval.** What `recommend_products` does today, but operating on the narrowed pool. Embed the soft preferences, find nearest neighbors in pgvector. Pull 30-50 candidates. The semantic match is where vibe, style, and abstract preference get matched.

**Stage 4 — Mode-specific re-ranking.** Each mode has a re-ranker that weights the candidates against mode-relevant signals. Fashion ranks by style coherence with the user's profile, occasion fit, color match. Jewellery ranks by occasion appropriateness, price band, purity match. Electronics ranks by use-case fit, compatibility, feature alignment. Each re-ranker is a small TypeScript module — `reranker.fashion.ts`, `reranker.jewellery.ts` — with a shared interface. New modes are new files, not rewrites.

**Stage 5 — Merchant signal injection.** Boost products the merchant has flagged as hero items, products in a "featured" collection, recent bestsellers, products from a collection the user's previous selections cluster in. This is the stage where merchant-curated signal beats raw similarity, which is what we want — the merchant knows their catalog better than any embedding does.

**Stage 6 — Diversity and presentation.** Don't return six near-duplicates. Spread across price tiers, across sub-categories, across styles within the user's preference. Return the top 6 cards, but Claude sees the full top 30 in tool result and writes the recommendation paragraph against that broader context.

Today's pipeline collapses stages 1, 2, 3, and 6 into a single embed-and-match call, and skips 4 and 5 entirely. The shift to staged pipeline is the single biggest quality lever available.

---

## 5. Mode awareness and multi-category stores

Every stage above is mode-aware. The mode is set at merchant onboarding (FASHION, JEWELLERY, ELECTRONICS, FURNITURE, BEAUTY, GENERAL) and determines which intent schema, which hard filters, which re-ranker, and which merchant signals are active.

Multi-category stores — a merchant who sells both clothing and accessories, or both furniture and home decor — are handled by treating mode as a **per-product attribute** rather than a per-store one. The merchant configures their primary mode (the one most of their catalog falls under) and the engine auto-categorizes each product into a sub-mode based on productType, collections, and AI inference. At query time, the structured intent extraction (Stage 1) picks the relevant sub-mode, often by asking a clarifying question if ambiguous: "Are you looking for clothing or accessories?"

Multi-store at the platform level — different merchants, different modes, different catalogs — is already handled by the existing shopDomain scoping. Every table is shop-scoped, every embedding is shop-scoped, every query filters on shopDomain via the route-scoped session (not Claude-controllable). The architectural question is just: do we share *anything* across shops? The answer for v1 is no — each merchant's engine is isolated. Cross-merchant signals (e.g. "shoppers who liked X in store A liked Y in store B") are tempting but raise privacy and competitive concerns that aren't worth the v1 complexity.

---

## 6. The learning loop

Every chat session produces signal: which products got clicked, which got cart-added, which got purchased, which got ignored. Today we log nothing. The learning loop captures all of it and feeds it back into Stage 5 (merchant signal injection) as boost weights.

V1 implementation is heuristic, not learned. Per shop, per session, we maintain a rolling tally: for each product, how often was it shown, clicked, carted, purchased. We compute a `liftScore` per product (purchases / impressions, with confidence smoothing for low-volume products) and use it as a Stage 5 boost. This catches the obvious signal — the products that actually convert get surfaced more — without needing a real ML model.

V2, post-launch, is where a learned re-ranker becomes worth building. Once you have weeks of session data per merchant, you can train a simple gradient-boosted ranker that incorporates user profile features, product features, and historical conversion. That is post-launch work. V1 ships with the heuristic and proves the loop closes.

The learning loop also informs **AI tag improvement.** When products consistently convert despite poor semantic match (low topDistance lift), it's a signal that our auto-tags missed something. Surface those mismatches in the admin tagging UI for the merchant to correct, and the merchant's corrections feed back into the next AI tagging pass.

---

## 7. UI architecture

UI is a separate workstream from the recommendation engine, and we treat it that way deliberately. Features ship first with **functional v0 UI** — whatever interface is necessary for the feature to be testable end-to-end. A dedicated **designed v1 UI pass** lands later, after enough features are built that the design language is grounded in real product surfaces. This is not laziness; it is what lets us avoid designing screens for features whose shape is still in flux.

The architectural commitment that makes this work: every visible component is **replaceable without touching business logic.** Page-level layout, form components, card components, dashboard widgets — they all consume from a stable API surface, so the v1 redesign is a frontend-only PR. Business logic, server actions, Prisma queries do not move when the design lands.

### The two surfaces

**Admin (merchant-facing).** The Shopify embedded app — Polaris + App Bridge, Polaris web components and `s-*` primitives where they exist, custom React only where Polaris doesn't cover the use case (which is rare). This is where the merchant configures the app, reviews AI tags, monitors performance, and curates their brand voice. Everything in admin is functional from the start because Polaris gives us reasonable defaults for free; the v1 design pass tightens copy, layout density, and brand presence.

**Storefront (customer-facing).** Theme app extension + a custom React-based chat widget loaded into the live theme. This is where the customer actually interacts with the agent. Storefront UI is the inverse of admin — minimal Polaris (it's not a Shopify-admin context), heavy reliance on a small in-house design system that matches the merchant's storefront where possible. Storefront is where polish matters most because shoppers leave fast.

### Admin surfaces (the full set)

These are the screens the admin app needs by launch. Each is listed with its v0 functional state and what the v1 design pass adds.

**Onboarding wizard** — first-run experience after install. Mode selection (FASHION/JEWELLERY/ELECTRONICS/FURNITURE/BEAUTY/GENERAL), basic feature toggles (chat widget on/off, CTA on/off, quiz enabled, lookbook enabled), CTA copy and placement. v0 is a Polaris stepped form. v1 adds illustrations, mode-specific preview, and a "what your customers will see" inline demo.

**Configuration page** — merchant updates settings post-onboarding. Welcome message, agent name, store mode (with warning that changing it triggers re-tagging), feature toggles, CTA config. Already shipped as Feature 001; v0 is fine, v1 polishes.

**Brand voice / playbook editor** — the merchant writes free-text instructions to the agent ("we sell handcrafted heritage jewellery; prioritize craft and provenance over price"). Stored as a string, prepended to the system prompt at chat time. Open question whether this ships v1 or v1.1 — leaning v1 because it's high-leverage for non-fashion stores.

**Knowledge sync status page** — what we ingested, when, from where, with manual re-trigger buttons per source. One section per data source: products (last webhook, last cron run, count), reviews (per app, last sync, count), blogs (last scrape, list of pages indexed), AI tags (last batch, count tagged, queue status). v0 is a dense Polaris IndexTable with status badges; v1 makes it scannable and adds visual freshness indicators.

**Tagging review UI** — Phase 13b, expanded. Browse products, see their AI-assigned tags side-by-side with merchant tags, approve/edit/reject per product, bulk-edit by collection or productType. Plus configuration: which metafields should be treated as hard filters (Stage 2 of the pipeline), which collections should boost in Stage 5. v0 is functional and dense; v1 adds the polish that makes bulk operations feel fast.

**Analytics dashboard** — sessions, chat starts, completions, agentic add-to-carts, agentic orders, revenue attributed to AI, top performing products, conversion by agent, quiz drop-off. v0 leans on Polaris charts and tables. v1 redesigns the layout and the headline-metric hierarchy — the most important number ("revenue attributed this month") should be the largest thing on the page.

**Live activity view** — optional but powerful: who's currently in chat, what they've asked, latest tool calls. Aimed at merchants who want to spot-check their agent. v0 is a simple feed; v1 makes it a real operational tool.

**Settings shared across all pages** — webhook health, API key status, billing info (when we add it), team access (when we add it). Lives in a shared admin shell.

### Storefront surfaces (the full set)

**Chat widget** — already shipped, still iterating. Floating button → opens a panel → message thread + product cards rendered inline + composer at the bottom. v0 already exists and works. v1 redesigns the visual treatment: typography, message bubble style, card density, mobile gesture support. This is the highest-stakes surface because every shopper sees it.

**CTA-near-Add-to-Cart** — theme app extension, dynamically labeled button placed next to or near the Add to Cart button on PDP. Opens chat with product context pre-loaded. v0 is a Liquid block with a basic label. v1 styles it to match the merchant's theme buttons (auto-detected) and animates the open transition.

**Product card (used inside chat)** — image, title, price, compare-at price strikethrough, AI-pick badge, Add to Cart button, View Details link. v0 already exists. v1 polishes the variant selector for products with options, fixes the badge placement, makes the card responsive to widget width.

**Lookbook viewer** — FASHION mode. Generated outfit collections with size, fit, styling notes; user can scroll, save, download. v0 is a vertical list of cards with download triggers. v1 is the actual reading experience: hero images, layout that resembles editorial fashion content rather than a product list.

**Image upload UI** — FASHION mode. Front, back, side photos for body type analysis. Privacy notice, upload progress, retry on failure. v0 is a simple file input with previews. v1 makes the privacy posture clear, adds inline guidance ("stand against a plain wall, full body in frame"), handles errors gracefully.

**Quiz UI** — already exists inline in the chat thread. Each question is a message with tappable options. v0 works; v1 polishes message density, button styling, and adds a progress indicator so the user knows how many questions remain.

**Auth / account upsell** — when the user wants to save a lookbook or get notified about restocks, they need an account. v0 is a generic Shopify customer login link. v1 inlines the account creation in the chat itself where Shopify allows.

### Cross-cutting concerns

**Component library.** Both surfaces share a small set of design primitives — typography scale, color tokens (mapped to merchant theme on storefront, fixed on admin), spacing scale, button variants, badge styles. This is a `app/lib/ui/` (or similar) module that both admin and storefront import. The v1 design pass crystallizes this; v0 uses Polaris on admin and a minimal token set on storefront.

**Design hand-off process.** Designs arrive (Figma is the assumption). Claude Code reads designs from screenshots or exported specs, implements them in TSX. This works well for component-level designs and reasonably well for full pages, but the iteration loop matters: implementing once and shipping is a recipe for misaligned pixels. Plan one polish round per surface after the first implementation.

**Accessibility.** Polaris handles most of admin's WCAG conformance for free. Storefront is the harder side — the chat widget needs keyboard navigation, screen reader support, focus management, and ARIA roles done right. This is part of the dedicated UI workstream, not optional.

**Localization.** Multi-language scaffolding from day one (every visible string goes through a translation function), but actual translation files arrive as the merchant configures their target markets. v0 ships English-only with the scaffolding in place. v1 adds Hindi for the initial dev store, then expands.

**Mobile.** Storefront is mobile-first because shoppers are mobile. Admin is mobile-aware (Shopify admin is heavily mobile, but config workflows are reasonably done on desktop) — design for desktop primary, ensure it doesn't break on mobile, don't optimize for mobile primary.

**Performance.** Storefront budgets: chat widget JS bundle under 100KB gzipped, time-to-interactive under 1s on 3G, theme extension Lighthouse impact near zero. Admin budgets: page TTI under 2s on broadband. These are real numbers we measure against, not aspirations.

### Sequencing

UI work happens in two passes, after the engine and features are mostly built:

**Pass 1 — UI polish on functional surfaces (Week 6).** All v0 surfaces are functional by Week 5. Pass 1 is a focused review round: copy tightening, layout density, accessibility audit, mobile pass. No redesign, just hygiene. Anything obviously wrong gets fixed.

**Pass 2 — designed v1 implementation (Weeks 7-8).** Designs land. Claude Code implements per-surface, one per session ideally. Polish round per surface. This is where the product looks like a product, not a working prototype.

The rationale for separating UI from feature work: a redesign that lands while features are still in flux gets thrown away when the feature changes shape. By the time Pass 2 starts, the feature surface is stable.

---

## 8. Budgets

Concrete numbers to design against, so we don't end up with a beautiful architecture that costs $50/month per merchant and takes 12 seconds per turn.

**Latency budget per chat turn:** 8 seconds end-to-end p95, 5 seconds p50. Today we're at ~7-11 seconds, so we have to *gain* time even as we add stages. Wins come from: hard filters dramatically narrowing the embedding space, parallel execution of Stages 2-5 where possible, caching the embedding of repeated intents (many users ask similar things), and aggressive reuse of the structured intent across follow-up turns.

**Cost budget per merchant per month:** $5–15 for a small store (1k products, 100 sessions/day), $30-60 for a mid-size store (10k products, 1000 sessions/day). Largest cost components: Claude API calls (~$0.01 per chat turn at current sizes — manageable), Voyage embeddings (one-time per product per change, ~$0.0001 per product per re-embed — negligible at steady state, expensive at initial ingestion), AI tagging on Haiku (~$0.001 per product). At 10k products with monthly refresh, AI tagging is ~$10/mo per merchant — the dominant offline cost. Worth it.

**Storage budget:** pgvector indexes scale with catalog size; expect ~50MB per 10k products including the rich product knowledge record. Reviews and blogs add maybe another 20MB per merchant. Negligible at Railway pricing.

These budgets are aggressive but not heroic. They require us to be disciplined about caching and to avoid re-running expensive steps unnecessarily. They do not require us to cut features.

---

## 9. What ships at launch (v1) — sequencing

All of the above is v1. The honest timeline with UI included is **6-8 weeks**, not the original 12 days from yesterday's handoff.

**Week 1 — Knowledge ingestion foundation.** Extend the data layer to capture metafields, metaobjects, collections, full descriptionHtml. Webhook subscriptions for all of them. Database schema for the unified product knowledge record. Initial backfill for the dev store's 1169 products.

**Week 2 — AI tagging engine + functional admin tagging UI.** Phase 13 + 13b as planned, but with the richer input now available. AI tags layer on top of the product knowledge record. Functional v0 admin UI to review, edit, approve, and configure which metafields the merchant wants treated as hard filters. Polaris defaults; design polish later.

**Week 3 — Pipeline rewrite.** Stages 1-6 implemented for FASHION mode first (since that's the dev store). Structured intent extraction, hard filtering, mode-specific re-ranker, merchant signal injection, diversity. Stylist Agent (Phase 010) builds against this new pipeline rather than the old `recommend_products` shape.

**Week 4 — Reviews + blog ingestion + learning loop v1 (heuristic).** Review app integration for the top 2-3 review apps. Blog scraper. Session-level tally tracking. Stage 5 boost weights. Sync status admin page (functional v0).

**Week 5 — Other modes + agentic checkout + lookbook + brand voice playbook.** Re-rankers for JEWELLERY, ELECTRONICS, FURNITURE, BEAUTY, GENERAL. Phase 14 agentic checkout via Checkout MCP with ECP/Checkout Kit fallback. Lookbook generator (FASHION). Brand voice playbook editor (functional v0).

**Week 6 — UI Pass 1 + analytics dashboard + compliance + perf.** All functional surfaces get a hygiene pass: copy, layout density, accessibility audit, mobile pass. Analytics dashboard built (functional v0). GDPR webhooks, performance budget enforcement.

**Weeks 7-8 — UI Pass 2 (designed v1).** Designs land. Claude Code implements them per-surface. Admin onboarding wizard, configuration page, tagging UI, analytics, sync status, brand voice — each gets the design pass. Storefront chat widget, CTA, product card, lookbook viewer, image upload — same. Polish round per surface.

**Week 8 final days — App Store submission prep.** Screenshots, listing copy, demo video, App Store review fields, privacy policy, support contact. Submit.

This sequence ships everything. The UI being a separate workstream (Weeks 6-8) means features are battle-tested against real user flows before designs are committed, which is the right order.

What it does **not** survive: a launch deadline shorter than 6 weeks. If at any point the timeline gets compressed by external pressure (App Store review window, merchant commitment, market timing), the cuts in priority order are: (1) brand voice playbook to v1.1, (2) reviews to v1.1, (3) blog ingestion to v1.1, (4) image upload to v1.1, (5) live activity view to v1.1. Each of those is a 1-3 day saving. After that, deeper cuts touch core engine work and aren't recommended.

---

## 10. What this displaces

Several phases on the existing roadmap get absorbed or reordered:

- Phase 010 (Stylist Agent) is rewritten to build against the new pipeline. Same goal, different foundation. Lands in Week 3.
- Phase 12b.5 (embedding sync hook + cron) becomes part of Week 1's broader sync architecture.
- Phase 12e (better OOS UX) is subsumed — Stage 2 hard filtering with explicit "out-of-stock-but-similar-available" messaging covers it.
- Phase 12f (recommendation intelligence v2) is the work itself, no longer deferred.
- Phase 13 + 13b (AI tagging + admin UI) move to Week 2, expanded scope.
- Order sync stays where it is, used by the learning loop.
- Heuristic self-learning becomes Week 4, integrated rather than bolted on.
- All UI polish work consolidates into Weeks 6-8 instead of dripping across phases.

The roadmap from yesterday's handoff served the old architecture and assumed the old launch timeline. This brief defines the new one, and the next planning document will produce a phase-by-phase HANDOFF.md against it.

---

## 11. Open questions

A few things this brief doesn't decide, on purpose, because they need merchant input or testing:

- **Which review apps to support first.** Judge.me and Yotpo are the safest starting points (largest install base on Shopify), but the dev store's choice should drive priority. Ask the dev store merchant.
- **How aggressive to be with blog scraping.** Polite (respect robots.txt, conservative rate, weekly cadence) vs aggressive (daily, all blog posts). Default polite; revisit if blog signal turns out to be high-leverage.
- **Brand voice playbook v1 vs v1.1.** Leaning v1 because non-fashion stores need it more than fashion. Decision deferred until Week 5 priorities firm up.
- **Cross-mode behavior in GENERAL stores.** A truly multi-category store probably needs an explicit category-picker turn before recommendations. Test with a real general store before committing.
- **Design language for storefront.** Heavy on the merchant's brand (auto-detect their theme tokens) vs distinctive AI-stylist look (recognizable across all stores). Both have arguments. Designs that arrive in Weeks 7-8 will answer this.
- **Live activity view scope.** Useful for merchants who care; clutter for merchants who don't. Default to off, opt-in toggle.

These are decisions to make as the work lands, not to settle now.

---

*End of brief. Next planning step: rewrite the launch roadmap into a phase-by-phase HANDOFF.md against this architecture, then write the Phase 010 (Stylist Agent) planning prompt with this north star in scope.*
