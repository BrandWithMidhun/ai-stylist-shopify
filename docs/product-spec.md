\# 🚀 AI STYLIST AGENT SHOPIFY APP

\## Complete Product \& Technical Specification



> \*\*Canonical source of truth for product decisions.\*\* This doc reflects what is actually built; update it as features ship. For best practices and platform rules, see `docs/shopify-best-practices.md`.



\---



\# 🧠 1. PRODUCT OVERVIEW



This project is a \*\*Shopify embedded AI Agent platform\*\* designed to improve conversion rates, increase AOV, and personalize the shopping experience.



The system introduces:

\- A \*\*dynamic CTA near Add to Cart\*\* (conversion trigger)

\- A \*\*chat-based AI shopping assistant\*\*

\- A \*\*configurable onboarding quiz (inside chat)\*\*

\- A \*\*multi-agent system (Stylist + Commerce)\*\*

\- \*\*Agentic commerce actions (add to cart, checkout inside chat)\*\*

\- A \*\*product intelligence layer for tagging and grouping\*\*

\- A \*\*learning and analytics system for optimization\*\*



\---



\# 🎯 2. CORE OBJECTIVES



\- Increase conversion rate (primary goal)

\- Increase average order value (AOV)

\- Reduce decision friction for customers

\- Provide personalized shopping assistance

\- Deliver measurable ROI to merchants



\---



\# 🧩 3. SYSTEM ARCHITECTURE



```

Frontend (Shopify Embedded App + Theme Extension + Chat Widget)

&#x20;       ↓

Agent Orchestrator (Backend Service)

&#x20;       ↓

\-------------------------------------------------

| Onboarding Agent (Quiz Engine)                |

| Styling Agent (Fashion)                       |

| Commerce Agent (Universal)                    |

| Product Intelligence Engine                   |

| Bundle \& Recommendation Engine                |

| Lookbook Generator                            |

| Learning \& Analytics Engine                   |

\-------------------------------------------------

&#x20;       ↓

PostgreSQL Database (Railway)

&#x20;       ↓

Shopify APIs (Admin + Storefront + Checkout MCP)

```



\---



\# 💬 4. USER EXPERIENCE (END-TO-END)



\## Entry Points



1\. \*\*Chat Widget (All Pages)\*\* — floating widget for search, support, recommendations

2\. \*\*CTA Near Add to Cart (CRO Layer)\*\* — dynamically labeled button that opens chat with product context



\## Core Flow



```

User clicks CTA or chat

→ Chat opens

→ If new user → conversational quiz starts

→ Profile is built dynamically

→ Optional image upload

→ AI generates recommendations

→ User interacts with products

→ Add to cart inside chat

→ Checkout via Shopify

```



\---



\# 🧩 5. MULTI-INDUSTRY SUPPORT



The system is designed to work across industries.



\### Fashion Mode

\- Full quiz enabled

\- Image upload enabled

\- Stylist agent active

\- Lookbook generation enabled



\### Generic Commerce Mode (Electronics, Furniture, Beauty, General)

\- Lighter quiz

\- No image upload

\- Focus on search, filters, recommendations

\- Commerce agent only



\### Hybrid Mode

\- Intent-based switching between agents



Fashion-only features (locked to `storeMode === "FASHION"`):

\- Stylist agent

\- Lookbook generation

\- Body-type image analysis

\- Body/fit/size quiz questions



\---



\# ⚙️ 6. MERCHANT ONBOARDING SYSTEM



Upon app installation, merchants configure (via `/app/config`):



\*\*Store Type:\*\* Fashion, Electronics, Furniture, Beauty, General



\*\*Feature Toggles:\*\* Chat widget, CTA enable/disable, Quiz, Lookbook (fashion-only), Stylist agent (fashion-only), Commerce agent



\*\*CTA Customization:\*\* Label text (max 60 chars), placement (product page / global / collection)



\*\*Data Storage:\*\* App database (default). Optional Shopify metafields sync (later).



\---



\# 🧪 7. QUIZ SYSTEM (CHAT-BASED)



Runs inside the chat. Dynamic and adaptive. Backend-configurable. Supports nested logic.



\*\*Data captured:\*\* Gender, age group, body type (fashion-only), fit preference (fashion-only), lifestyle, style preference, budget sensitivity, color preferences.



\*\*Behavior:\*\* One question at a time, follow-ups based on answers, skippable.



\---



\# 📸 8. IMAGE ANALYSIS (FASHION MODE)



Inputs: front / back / side-profile images.

Outputs: body-type estimation, size recommendation, fit guidance.

Used to improve stylist personalization.



\---



\# 👤 9. USER PROFILE SYSTEM



Stores quiz responses, image analysis results, preferences, interaction history. Used by styling agent, recommendation engine, lookbook generator.



\---



\# 🧠 10. AGENT SYSTEM



\### Agent Orchestrator



Manages user session, tracks state (new user, quiz completed, etc.), detects intent, routes to the correct agent, combines outputs.



\### Styling Agent (Fashion-only)

Generates outfits, suggests combinations, explains choices, personalizes from user profile.



\### Commerce Agent (Universal)

Handles product search, filters, offers, cart operations. Works across all industries.



\---



\# 🔍 11. INTENT DETECTION



User messages classified into: `onboarding`, `styling\_request`, `product\_search`, `general\_query`.



Routing based on: store mode, user profile state, detected intent.



\---



\# 🧬 12. PRODUCT INTELLIGENCE ENGINE



\*\*Purpose:\*\* Enhance product data automatically.



\*\*Functions:\*\* Auto-tag products, normalize attributes, detect missing fields, map to filters.



\*\*Tag dimensions:\*\* Category, price range, availability, color, size, occasion (fashion), style (fashion).



\*\*Admin control:\*\* Manual editing, bulk updates, tag approval.



\---



\# 🧩 13. PRODUCT GROUPING \& FILTERING



Products grouped dynamically by category, price range, style, color, merchant-defined filters. Used for recommendations, bundles, search results.



\---



\# 🛍️ 14. AGENTIC COMMERCE



Commerce actions inside chat: add to cart, modify cart, view cart summary, generate checkout link. Built on Shopify's Checkout MCP with ECP / Checkout Kit fallbacks per the UCP spec (see `docs/shopify-best-practices.md` Part 2).



\---



\# 📸 15. LOOKBOOK SYSTEM (FASHION)



Personalized outfit collections with size, fit, and styling notes. Downloadable. Requires user login.



\---



\# 📊 16. ANALYTICS \& DASHBOARD



\*\*Core metrics:\*\* Total sessions, live users in chat, chat started/completed, agentic add-to-cart, agentic orders, revenue attributed to AI.



\*\*Advanced metrics:\*\* Average chat duration, quiz drop-off rate, top-performing products, conversion by agent.



\---



\# 📡 17. EVENT TRACKING



\*\*Events:\*\* `chat\_started`, `chat\_ended`, `agentic\_add\_to\_cart`, `agentic\_purchase`.



\*\*Integrations:\*\* Meta Pixel, Google Analytics (GA4), Google Ads (via GA4 conversions).



\---



\# 🧬 18. LEARNING SYSTEM



Tracks user clicks, product interactions, purchases. Uses the data to improve recommendations, adjust ranking, personalize further.



\---



\# ⚙️ 19. TECH STACK (ACTUAL — as built)



\*\*Framework:\*\* Shopify App Template — React Router 7 (not Next.js, not legacy Remix). The official Shopify-recommended template for new embedded apps.



\*\*Language:\*\* TypeScript throughout.



\*\*Auth:\*\* Shopify-managed install (token exchange). Default in this template.



\*\*UI:\*\* Polaris web components (`<s-page>`, `<s-section>`, `<s-button>`, etc.) for embedded admin pages. App Bridge for admin integration. Custom UI reserved for the storefront chat widget only.



\*\*Database:\*\* PostgreSQL via Prisma ORM. Local dev runs in Docker; production on Railway.



\*\*Session storage:\*\* `@shopify/shopify-app-session-storage-prisma`.



\*\*API style:\*\* GraphQL Admin API only. No REST.



\*\*LLM layer:\*\* Anthropic Claude via Anthropic Node SDK (Sonnet default; Opus reserved for complex reasoning).



\*\*Shopify surfaces used:\*\* Admin (embedded), Theme App Extension (CTA), Checkout MCP (agentic checkout, Phase 4).



\*\*Hosting:\*\* Railway (single web service for the app; worker services added only when background jobs require them).



\*\*Developer tooling:\*\* Shopify CLI, Shopify AI Toolkit / Dev MCP, Claude Code, Prisma CLI, ESLint.



\---



\# 🧑‍💻 20. INITIAL SETUP REQUIREMENTS



\*\*Developer environment:\*\* Node.js 20.10+, Shopify CLI, Claude Code, Docker Desktop, Git + SSH to GitHub, Shopify AI Toolkit / Dev MCP.



\*\*Project bootstrapping:\*\* Shopify app scaffolded via `shopify app init --template=shopify-app-template-react-router`. Git repo initialized, OAuth + webhook HMAC validation working, API secrets loaded from `.env` (gitignored).



\*\*Accounts required:\*\* Shopify Partners, GitHub, Railway, Anthropic.



\---



\# 🚀 21. DEVELOPMENT PHASES



\### Phase 0 — Foundation \& Shopify Alignment

Install Dev MCP, scaffold via CLI, confirm surface decisions, set up OAuth + webhook HMAC + secret rotation, confirm UCP patterns. \*\*Status: ✅ Complete.\*\*



\### Phase 1 — Infrastructure

Backend, database schema, Shopify integration (GraphQL Admin + Storefront), webhooks for products / orders / customers, metafield / metaobject schema for user profiles and quiz data. \*\*Status: 🟡 In progress.\*\*



\### Phase 2 — Merchant-Facing Layer

Product intelligence (auto-tagging), merchant onboarding flow, embedded admin UI (Polaris + App Bridge), Theme App Extension for CTA. \*\*Status: ⏳ Not started.\*\*



\### Phase 3 — Agent \& Chat System

Chat widget (theme extension + embedded), agent orchestrator, Styling + Commerce agents, quiz engine, recommendations. \*\*Status: ⏳ Not started.\*\*



\### Phase 4 — Agentic Commerce \& Analytics

Checkout MCP integration with ECP / Checkout Kit fallbacks, lookbook generation, analytics dashboard, event tracking (Meta Pixel, GA4, Google Ads), Orders MCP when available. \*\*Status: ⏳ Not started.\*\*



\### Phase 5 — Compliance \& Launch Readiness

Accessibility audit, localization, performance budgets, mobile testing, non-deceptive code review, GDPR webhook handlers, App Store submission. \*\*Status: 🟡 Partial — GDPR webhooks shipped as Feature 003.\*\*



\---



\# 📋 22. SHIPPED FEATURES



| Feature | Spec | Status | Phase |

|---|---|---|---|

| 001 | Merchant Configuration Page | ✅ Shipped | 2 |

| 001.1 | Gate Stylist agent to Fashion mode | ✅ Shipped | 2 |

| 002 | App uninstall webhook cleanup | ✅ Shipped | 1 / 5 |

| 003 | GDPR compliance webhooks | ✅ Shipped | 5 |



Update this table as features ship.



\---



\# 🔥 FINAL POSITIONING



This system is:



👉 \*\*An AI-powered conversion and personalization layer for Shopify stores\*\*



It acts as:

\- personal shopping assistant

\- product discovery engine

\- conversion optimization tool

