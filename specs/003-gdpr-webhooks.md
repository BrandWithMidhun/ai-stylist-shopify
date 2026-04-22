\# Feature 003: GDPR Compliance Webhooks



\## Purpose



Shopify's App Store submission rules require every app to implement three mandatory GDPR webhook endpoints. These webhooks let Shopify propagate customer data rights (access, erasure) and shop-level redaction requests down to every installed app.



Without these three endpoints returning 200, the app cannot be submitted to the App Store. They also carry legal weight under GDPR and similar regimes.



\## Background



Phase 1 of this app stores:

\- `Session` — Shopify OAuth tokens (shop-scoped, no customer data)

\- `MerchantConfig` — merchant settings (shop-scoped, no customer data)



No customer-scoped data exists yet. Future features (user profile, chat session, interaction event) will add customer-scoped data — at that point we'll extend these handlers.



Shopify fires these webhooks automatically once subscribed in `shopify.app.toml`. Subscriptions are currently missing and need to be added.



\## Scope



\### Three new webhook handlers



All three follow the same shape:

\- Authenticate the webhook via `authenticate.webhook(request)`

\- Parse the payload (see Shopify's GDPR webhook reference for payload shapes)

\- Do the right thing for Phase 1 (see below)

\- Log the event with a structured line

\- Return 200



Handlers:



1\. \*\*`app/routes/webhooks.customers.data-request.tsx`\*\* — topic: `customers/data\_request`

&#x20;  - Phase 1 behavior: log the request, respond 200. We hold no customer data.

&#x20;  - Future behavior: gather all data we hold about the given customer and expose it (mechanism TBD — email to merchant? admin UI? Out of scope now).



2\. \*\*`app/routes/webhooks.customers.redact.tsx`\*\* — topic: `customers/redact`

&#x20;  - Phase 1 behavior: log the request, respond 200. Nothing to delete.

&#x20;  - Future behavior: delete any rows where the customer ID matches.



3\. \*\*`app/routes/webhooks.shop.redact.tsx`\*\* — topic: `shop/redact`

&#x20;  - Phase 1 behavior: call `runShopCleanup(shop)` as a belt-and-suspenders cleanup. Log the result. Respond 200.

&#x20;  - Future behavior: same, plus any customer-scoped data that was not already cleaned up.



\### Subscriptions in `shopify.app.toml`



Add all three subscriptions to the existing `\[webhooks]` block. Use `api\_version` matching the rest of the file.



\### Structured logging



Every handler logs a single structured line so we have an audit trail. Log format:

## Out of scope



\- Actual customer data retrieval UI (Feature 007+)

\- Email notifications to the merchant when a data request comes in

\- Data export format specifications

\- Long-term log retention — we're logging to stdout only for now



\## Definition of done



\- \[ ] Three new route files exist and return 200 on valid requests

\- \[ ] `shopify.app.toml` subscribes all three topics

\- \[ ] `shop/redact` reuses `runShopCleanup` — no duplicated deletion logic

\- \[ ] Each handler logs a single structured line

\- \[ ] All three handlers are idempotent

\- \[ ] `npm run build` passes

\- \[ ] `npm run lint` passes

\- \[ ] `shopify app deploy` succeeds and Shopify Partners dashboard shows the new subscriptions (we'll deploy after verification)

