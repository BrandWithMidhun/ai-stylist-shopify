# AI STYLIST AGENT SHOPIFY APP
## Complete Product & Technical Specification

> Canonical source of truth for product decisions. This doc reflects what is actually built; update it as features ship.

---

# 1. PRODUCT OVERVIEW

This project is a Shopify embedded AI Agent platform designed to improve conversion rates, increase AOV, and personalize the shopping experience.

The system introduces:
- A dynamic CTA near Add to Cart (conversion trigger)
- A chat-based AI shopping assistant
- A configurable onboarding quiz inside chat
- A multi-agent system (Stylist + Commerce)
- Agentic commerce actions (add to cart, checkout inside chat)
- A product intelligence layer for tagging and grouping
- A learning and analytics system for optimization

---

# 2. CORE OBJECTIVES

- Increase conversion rate (primary goal)
- Increase average order value (AOV)
- Reduce decision friction for customers
- Provide personalized shopping assistance
- Deliver measurable ROI to merchants

---

# 3. SYSTEM ARCHITECTURE

Frontend (Shopify Embedded App + Theme Extension + Chat Widget) flows down to the Agent Orchestrator (Backend Service), which contains the Onboarding Agent, Styling Agent (Fashion), Commerce Agent (Universal), Product Intelligence Engine, Bundle and Recommendation Engine, Lookbook Generator, and Learning and Analytics Engine. The orchestrator writes to a PostgreSQL database on Railway and talks to Shopify APIs: Admin, Storefront, and Checkout MCP.

---

# 4. USER EXPERIENCE

## Entry Points

1. Chat Widget (all pages) — floating widget for search, support, recommendations.
2. CTA Near Add to Cart (CRO layer) — dynamically labeled button that opens chat with product context.

## Core Flow

User clicks CTA or chat, chat opens, if new user conversational quiz starts, profile is built dynamically, optional image upload, AI generates recommendations, user interacts with products, add to cart inside chat, checkout via Shopify.

---

# 5. MULTI-INDUSTRY SUPPORT

### Fashion Mode
- Full quiz enabled
- Image upload enabled
- Stylist agent active
- Lookbook generation enabled

### Generic Commerce Mode (Electronics, Furniture, Beauty, General)
- Lighter quiz
- No image upload
- Focus on search, filters, recommendations
- Commerce agent only

### Hybrid Mode
- Intent-based switching between agents

Fashion-only features (locked to storeMode equals FASHION): Stylist agent, Lookbook generation, Body-type image analysis, Body/fit/size quiz questions.

---

# 6. MERCHANT ONBOARDING SYSTEM

Merchants configure via /app/config.

Store Type: Fashion, Electronics, Furniture, Beauty, General.

Feature Toggles: Chat widget, CTA enable/disable, Quiz, Lookbook (fashion-only), Stylist agent (fashion-only), Commerce agent.

CTA Customization: Label text (max 60 chars), placement (product page, global, or collection).

Data Storage: App database (default). Optional Shopify metafields sync (later).

---

# 7. QUIZ SYSTEM

Runs inside the chat. Dynamic, adaptive, backend-configurable, supports nested logic.

Data captured: Gender, age group, body type (fashion-only), fit preference (fashion-only), lifestyle, style preference, budget sensitivity, color preferences.

Behavior: One question at a time, follow-ups based on answers, skippable.

---

# 8. IMAGE ANALYSIS (FASHION MODE)

Inputs: front, back, side-profile images.
Outputs: body-type estimation, size recommendation, fit guidance.

---

# 9. USER PROFILE SYSTEM

Stores quiz responses, image analysis results, preferences, interaction history. Used by styling agent, recommendation engine, lookbook generator.

---

# 10. AGENT SYSTEM

Agent Orchestrator: Manages user session, tracks state, detects intent, routes to the correct agent, combines outputs.

Styling Agent (Fashion-only): Generates outfits, suggests combinations, explains choices, personalizes from user profile.

Commerce Agent (Universal): Handles product search, filters, offers, cart operations. Works across all industries.

---

# 11. INTENT DETECTION

User messages classified as onboarding, styling_request, product_search, general_query. Routing based on store mode, user profile state, detected intent.

---

# 12. PRODUCT INTELLIGENCE ENGINE

Purpose: Enhance product data automatically.
Functions: Auto-tag, normalize attributes, detect missing fields, map to filters.
Tag dimensions: Category, price range, availability, color, size, occasion (fashion), style (fashion).
Admin control: Manual editing, bulk updates, tag approval.

---

# 13. PRODUCT GROUPING AND FILTERING

Products grouped dynamically by category, price range, style, color, merchant-defined filters. Used for recommendations, bundles, search results.

---

# 14. AGENTIC COMMERCE

Commerce actions inside chat: add to cart, modify cart, view cart summary, generate checkout link. Built on Shopify Checkout MCP with ECP and Checkout Kit fallbacks per the UCP spec.

---

# 15. LOOKBOOK SYSTEM (FASHION)

Personalized outfit collections with size, fit, and styling notes. Downloadable. Requires user login.

---

# 16. ANALYTICS AND DASHBOARD

Core metrics: Total sessions, live users in chat, chat started/completed, agentic add-to-cart, agentic orders, revenue attributed to AI.
Advanced metrics: Average chat duration, quiz drop-off rate, top-performing products, conversion by agent.

---

# 17. EVENT TRACKING

Events: chat_started, chat_ended, agentic_add_to_cart, agentic_purchase.
Integrations: Meta Pixel, Google Analytics (GA4), Google Ads via GA4 conversions.

---

# 18. LEARNING SYSTEM

Tracks user clicks, product interactions, purchases. Uses the data to improve recommendations, adjust ranking, personalize further.

---

# 19. TECH STACK (ACTUAL)

Framework: Shopify App Template, React Router 7. Not Next.js, not legacy Remix.
Language: TypeScript throughout.
Auth: Shopify-managed install via token exchange.
UI: Polaris web components for embedded admin pages. App Bridge for admin integration. Custom UI reserved for the storefront chat widget only.
Database: PostgreSQL via Prisma ORM. Local dev in Docker; production on Railway.
Session storage: Shopify app session storage Prisma adapter.
API style: GraphQL Admin API only. No REST.
LLM layer: Anthropic Claude via Anthropic Node SDK. Sonnet default; Opus reserved for complex reasoning.
Shopify surfaces used: Admin (embedded), Theme App Extension (CTA), Checkout MCP (agentic checkout, Phase 4).
Hosting: Railway. Single web service for the app; worker services added only when background jobs require them.
Developer tooling: Shopify CLI, Shopify Dev MCP, Claude Code, Prisma CLI, ESLint.

---

# 20. INITIAL SETUP REQUIREMENTS

Developer environment: Node.js 20.10 or higher, Shopify CLI, Claude Code, Docker Desktop, Git and SSH to GitHub, Shopify Dev MCP.
Project bootstrapping: Shopify app scaffolded via the React Router template. Git repo initialized, OAuth and webhook HMAC validation working, API secrets loaded from .env which is gitignored.
Accounts required: Shopify Partners, GitHub, Railway, Anthropic.

---

# 21. DEVELOPMENT PHASES

Phase 0 — Foundation and Shopify Alignment: Install Dev MCP, scaffold via CLI, confirm surface decisions, set up OAuth and webhook HMAC and secret rotation, confirm UCP patterns. Status: Complete.

Phase 1 — Infrastructure: Backend, database schema, Shopify integration (GraphQL Admin and Storefront), webhooks for products, orders, customers, metafield and metaobject schema for user profiles and quiz data. Status: In progress.

Phase 2 — Merchant-Facing Layer: Product intelligence (auto-tagging), merchant onboarding flow, embedded admin UI (Polaris and App Bridge), Theme App Extension for CTA. Status: Not started.

Phase 3 — Agent and Chat System: Chat widget (theme extension and embedded), agent orchestrator, Styling and Commerce agents, quiz engine, recommendations. Status: Not started.

Phase 4 — Agentic Commerce and Analytics: Checkout MCP integration with ECP and Checkout Kit fallbacks, lookbook generation, analytics dashboard, event tracking (Meta Pixel, GA4, Google Ads), Orders MCP when available. Status: Not started.

Phase 5 — Compliance and Launch Readiness: Accessibility audit, localization, performance budgets, mobile testing, non-deceptive code review, GDPR webhook handlers, App Store submission. Status: Partial — GDPR webhooks shipped as Feature 003.

---

# 22. SHIPPED FEATURES

| Feature | Spec | Status | Phase |
|---|---|---|---|
| 001 | Merchant Configuration Page | Shipped | 2 |
| 001.1 | Gate Stylist agent to Fashion mode | Shipped | 2 |
| 002 | App uninstall webhook cleanup | Shipped | 1 / 5 |
| 003 | GDPR compliance webhooks | Shipped | 5 |
| 004 | Anthropic API foundation | Shipped | 2 |

---

# 23. FINAL POSITIONING

An AI-powered conversion and personalization layer for Shopify stores. It acts as a personal shopping assistant, a product discovery engine, and a conversion optimization tool.
