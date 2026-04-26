\# Project state — pause point at end of 2026-04-26



\## Last shipped today

\- Phase 12c — recommend\_products tool with semantic retrieval (Voyage + pgvector)

\- Verified working: post-quiz returns coherent recommendations with Claude reasoning

\- topDistance 0.54, 1 tool call, 7.4s end-to-end

\- Earlier today: 12a (pgvector + out-of-stock filter), 12b (1169 products embedded)



\## Decisions made tonight

\- \*\*Self-learning approach\*\*: heuristic learning v1 (track clicks/cart-adds, boost similar products in next session). Learned re-ranker deferred until post-launch when interaction data exists.

\- \*\*Admin UI approach\*\*: build in parallel as designs arrive.

\- \*\*Storefront UI approach\*\*: send designs, Claude implements.



\## Tomorrow: start with Phase 12d

Three small fixes:

1\. Variant ordering bug — cards show "Out of Stock" when buyable variants exist. Fix `formatProductCard` in both search-products.server.ts and recommend-products.server.ts to prefer available variants (orderBy: availableForSale DESC, price ASC).

2\. Remove broken tag-AND from search\_products.

3\. Tighten system prompt's tool selection guidance based on observed 12c behavior.



\## Path to launch (\~12 focused days)



\### Sequenced phases

\- 12d — cleanup (30 min) — TOMORROW

\- 010 — Stylist Agent (1 day) — TOMORROW

\- 12b.5 — Embedding sync hook + Railway daily cron (0.5 day)

\- 13 — AI Tagging Engine, auto-tagging via Claude (1 day)

\- 13b — Tagging admin UI: review/approve/edit/bulk (1 day)

\- Order sync from Shopify (1.5 days)

\- Agentic checkout — Checkout MCP + ECP/Checkout Kit fallbacks (2 days)

\- Admin UI build-out from designs (parallel, \~2-3 days total)

\- Storefront UI build-out from designs (parallel, \~1-3 days total)

\- Lookbook system, FASHION mode (1 day)

\- Image upload + body type analysis, FASHION mode (1 day)

\- Heuristic self-learning — track clicks/cart-adds, boost similar in next session (1 day)

\- Analytics dashboard (1.5 days)

\- GDPR + accessibility + localization + mobile + perf budgets (2-3 days)

\- App Store submission prep (0.5 day)



\### Compliance reminders (non-negotiable for App Store)

\- GDPR webhooks (data request, redact, customer redact)

\- Accessibility audit via Polaris

\- Multi-language, multi-currency

\- Mobile-first testing

\- Performance budgets on theme extension



\## Things I should NOT forget

\- 1169-vs-2632 product split is correct (Drafts and Archived correctly filtered)

\- Voyage payment method is added; no rate-limit issues going forward

\- Local `.env` DATABASE\_URL points at Railway public proxy (NOT localhost)

\- pgvector is enabled on Railway Postgres

\- VOYAGE\_API\_KEY is set in both local `.env` and Railway env vars

\- Pre-existing TS error in app.config.tsx:280 (Polaris TextField type mismatch) — not blocking, address later

\- `.env.example` is gitignored on this repo

\- Tools registered: recommend\_products (semantic, listed first), search\_products (keyword fallback)

\- Co-purchase affinity is post-launch (needs order data)

\- Learned re-ranker is post-launch (needs interaction data)



\## Next session: kickoff

Paste this entire HANDOFF.md content into the new chat plus "starting Phase 12d" and we go.

