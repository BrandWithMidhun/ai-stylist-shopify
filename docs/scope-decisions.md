# Scope Decisions: Full Vision

**Decided by user on 2026-04-28.**

The product scope is the full instruction document + full UI design (`docs/ui-design-stylemate-v1.pdf`), minus the "Reply as AI" feature. UI is treated as source of truth for layout and flows. Honest sizing: ~37 weeks of focused work, ~9 calendar months at the established pace.

## Decisions locked

1. **Brand name:** Placeholder (`ai-stylist` internally) until launch. User-visible strings flow through a single `BRAND_NAME` constant for one-PR rename at launch.

2. **Multi-mode dashboard:** Single shared UI shell with show/hide based on `storeMode`. Sections designed for repurposing across modes (e.g. Style Quiz Results panel reused as Configurator Responses for furniture). Section reuse is intentional design discipline.

3. **Conversation retention:** 90 days raw transcripts, indefinite derived signals (clicks, ATC events, quiz-derived profile attributes).

4. **Integrations at launch:** Shopify (built), Meta Pixel, Google Analytics 4, one review provider (Yotpo or Judge.me — picked at integration time based on dev store availability). Klaviyo, Gorgias, Attentive, Recharge, LoyaltyLion, Postscript deferred to post-launch staged rollout. Integration framework built at launch so each post-launch integration is 3-5 days.

5. **Pricing — architecture vs. number split:**
   - **Architecture (locked):** Capture both conversation counts and AI-attributed revenue from day one. Build AI revenue attribution into Phase 3 (recommendation pipeline) and Phase 5 (conversations) as a non-billing analytics feature. Build the metering + billing surface in Phase 10. Both metrics flow into a billing-ready data layer that can drive any pricing model.
   - **Number/model (deferred):** Actual pricing model (pure conversation count, % of AI revenue, hybrid, flat tier) and dollar amounts decided ~3 weeks before launch (around Week 27). Architecture supports any of these models with a config change.

6. **Customer Profile data flow:** Bulk-fetch Shopify customers + orders on app install, create profiles keyed by `shopifyCustomerId`. Sync via webhooks (`customers/*`, `orders/*`). Identification cases:
   - Logged-in storefront shopper → linked by `shopifyCustomerId`
   - Anonymous shopper, completes lookbook download with email+mobile → lookup or create + merge
   - Never-identified → anonymous session token, derived signals captured, merged on later identification

7. **Auth model:** SSO through Shopify via App Bridge for v1. Magic link / non-Shopify auth deferred to year 2 if multi-platform expansion happens. Migration path stays open.

8. **Customer Profile prompt timing:** Lookbook download + substantive quiz completion (4+ questions answered). Anonymous sessions tracked by browser fingerprint pre-identification.

## Removed from scope

- "Reply as AI" merchant takeover. Conversations module is read-only for merchant.

## Sequencing constraints

- Phase 1 PR-B/C/D unaffected by UI scope. Proceeds first.
- Customer Profile schema must be designed before Conversations or Lookbook modules begin.
- Quiz schema must be designed before Quiz Builder UI or Stylist Agent integration.
- SaaS portal split into separate Next.js app affects Phase 4 onward.
- AI revenue attribution architecture lands by Phase 3 (needed for the pricing data layer per #5).

## Phase plan summary (~37 weeks)

Phase 1 finish: PR-B/C/D + customer/order webhooks + Customer Profile schema (~2 weeks)
Phase 2: Catalog Intelligence (~3 weeks; UI from user)
Phase 3: Recommendation engine pipeline rewrite + reviews + order ingest + AI attribution (~3 weeks)
Phase 4: SaaS portal foundation + Customer Profile + Dashboard Overview (~3 weeks)
Phase 5: Conversations module + attribution event tracking (~3 weeks)
Phase 6: Stylist Agent + Quiz Builder (~4 weeks)
Phase 7: Lookbook system (~2.5 weeks)
Phase 8: Knowledge Base (~2.5 weeks)
Phase 9: Size & Fit + Color Logic (~3 weeks)
Phase 10: Analytics + Pricing/Billing surface (~3 weeks)
Phase 11: Integrations launch set (~2 weeks)
Phase 12: Super Admin + Settings + multi-mode polish (~2.5 weeks)
Phase 13: Compliance + App Store submission (~2.5 weeks)

Plus architecture foundation work (~2 weeks) folded across early phases.

Shippable milestones:
- Week 14 (post-Phase 5): chat + conversations + analytics — usable by a real merchant
- Week 19 (post-Phase 7): lookbooks live — differentiator activates
- Week 27: pricing model + dollar amounts decided, billing flipped on
- Week 30 (post-Phase 11): launch-ready
- Week 37: App Store approved (assuming smooth review)

## Next session

Session produces:
- Updated `docs/recommendation-engine-brief.md` v0.3 (full vision)
- Detailed `HANDOFF.md` with 13-phase plan, week-by-week sizing, milestone gates
- PR-B planning prompt
- Resumed execution starting with PR-B

Until those produce, existing brief and HANDOFF remain authoritative.
