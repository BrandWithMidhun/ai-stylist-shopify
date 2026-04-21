# AI Stylist Shopify App — Claude Code Instructions

## Project Summary

An AI-powered conversion and personalization layer for Shopify stores. Provides:
- A dynamic CTA near Add to Cart (conversion trigger)
- A chat-based AI shopping assistant
- A configurable onboarding quiz (inside chat)
- A multi-agent system (Stylist + Commerce agents)
- Agentic commerce actions (add to cart, checkout inside chat)
- A product intelligence layer for auto-tagging and grouping
- A learning and analytics system for optimization

The goal is to increase conversion rate and AOV for merchants across fashion, electronics, furniture, beauty, and general commerce verticals.

Full product spec lives in two project documents:
- `shopify-app-agentic-commerce-instructions.md` — Shopify platform best practices & UCP/agentic commerce reference
- `ai_stylist_shopify_agent_project_instructions.md` — Full product spec for this app

Treat those two documents as the source of truth for product decisions. If a conflict arises between this file and those docs, the project docs win and this file should be updated.

## Architecture Decisions (locked)

- **Framework**: Shopify App Template — React Router 7. Not Next.js. Not legacy Remix.
- **Language**: TypeScript throughout. No plain JS in new files.
- **Auth**: Shopify-managed install (token exchange). This is the template default — do not change it.
- **Database**: PostgreSQL. Local dev via Docker Postgres (or Railway Postgres direct). Production on Railway Postgres. Session storage uses `@shopify/shopify-app-session-storage-prisma`.
- **API style**: GraphQL Admin API only. Never REST. If a Shopify resource is only available via REST, flag it and stop — do not silently fall back.
- **UI for embedded admin pages**: Polaris web components (`<s-page>`, `<s-button>`, etc.). No raw HTML, no Tailwind, no third-party component libraries inside admin pages.
- **Agent LLM**: Anthropic Claude via the Anthropic Node SDK. Sonnet for most agent calls; Opus reserved for complex reasoning tasks only.
- **Hosting**: Railway. One web service for the app. Add worker services only when background jobs demand it.
- **Platform**: Development happens on Windows. Tests should pass on Windows + Linux; CI will run on Linux.

## Rules for Claude

1. **GraphQL only** for Shopify API calls. Never REST.
2. **Polaris web components only** for embedded admin UI. No custom CSS frameworks.
3. **Before claiming done**: run `npm run lint` and `npm run build` (or the typecheck equivalent) and fix every error.
4. **Never commit secrets.** `.env`, `.env.local`, and any key file stay gitignored. If you need a new env var, add it to `.env.example` with a placeholder value.
5. **Use the Shopify Dev MCP** (already configured in `.mcp.json`) to verify GraphQL schemas, Polaris components, and API signatures. Do not guess field names.
6. **Prisma schema changes** always go through `npx prisma migrate dev --name <descriptive_name>`. Never edit the database by hand, and never use `prisma db push` in this project (it skips migration history).
7. **Authenticate every admin route.** Any new route file under `app/routes/app.*` must call `shopify.authenticate.admin(request)` in its loader/action.
8. **Keep files small.** Break anything over ~200 lines into smaller modules. Avoid "god files."
9. **Plan before multi-file changes.** For any task touching more than 2 files, explain the plan in plain English first, wait for confirmation, then execute.
10. **Ask, don't assume.** If a requirement is ambiguous, ask a single focused question rather than picking an interpretation and building on it.

## Domain Model (evolving)

These Prisma models exist or will exist in this order:

- `Session` — ships with the template, handles Shopify OAuth. Do not modify structure without reason.
- `MerchantConfig` — per-shop config: store mode (fashion/electronics/furniture/beauty/general), feature toggles, CTA text, CTA placement.
- `UserProfile` — quiz answers, image analysis results, preferences. Keyed to a shop customer or an anonymous session.
- `ChatSession` + `ChatMessage` — chat history with the AI agents.
- `ProductEnrichment` — AI-generated tags and attributes, keyed to Shopify product GID.
- `InteractionEvent` — learning system events (clicks, impressions, add-to-carts, purchases).

Keep this section updated whenever a new model is added or an existing one changes meaningfully.

## Build Phases

- **Phase 1 (current):** Infrastructure + merchant onboarding UI. No agents, no chat yet. Get the embedded admin page working, the DB schema stable, Railway deployment solid.
- **Phase 2:** Product intelligence engine (auto-tagging via LLM).
- **Phase 3:** Chat widget + agent orchestration + recommendations.
- **Phase 4:** Lookbook generation + agentic checkout + analytics dashboard.

Do not start Phase 2 work while Phase 1 items are unresolved.

## Common Commands

- `shopify app dev` — start local dev with tunnel
- `npm run setup` — initial Prisma DB setup
- `npx prisma migrate dev --name <name>` — create and apply a new migration
- `npx prisma studio` — open a local DB browser in the browser
- `npm run lint` — ESLint
- `npm run build` — build and typecheck
- `shopify app deploy` — push `shopify.app.toml` config changes to Partners

## Environment

Local dev on Windows. `PRISMA_CLIENT_ENGINE_TYPE=binary` is set at the user env level to prevent a known Prisma-on-Windows bug.