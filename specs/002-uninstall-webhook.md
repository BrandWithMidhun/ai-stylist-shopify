\# Feature 002: App Uninstall Cleanup



\## Purpose



When a merchant uninstalls the AI Stylist app from their store, we must delete all data we store about them so we don't accumulate orphan rows in our database. This is also a GDPR requirement and a Shopify App Store submission requirement.



\## Background



The React Router template already ships a webhook handler at `app/routes/webhooks.app.uninstalled.tsx` that deletes the Shopify `Session` rows for the uninstalling shop. We need to extend it to also delete our own merchant-specific data.



Shopify fires the `APP\_UNINSTALLED` webhook to this endpoint when a merchant removes the app. The webhook is subscribed via `shopify.app.toml` (already configured).



\## Scope



\- Extend `app/routes/webhooks.app.uninstalled.tsx` so that, in addition to deleting Sessions, it also deletes the `MerchantConfig` row for the uninstalling shop.

\- If a future model is added with a shop scope (e.g., `UserProfile`, `ChatSession`, `ProductEnrichment`), this handler will need to delete those too. Write the handler so adding a new deletion is a one-line change (e.g., a list of cleanup calls).

\- The handler must be idempotent — if the webhook fires twice (rare but possible), the second call should not crash.

\- Log what was deleted (shop domain + count of records), so we have an audit trail.



\## Out of scope



\- GDPR customer-data-request webhooks (`customers/data\_request`, `customers/redact`, `shop/redact`) — we'll build those as a separate feature (Feature 003) since they have different semantics (customer-scoped, not shop-scoped).

\- Soft delete, archiving, export-before-delete — we hard-delete for now. If we add retention later, that's a separate feature.

\- UI for confirming uninstall — Shopify's admin handles this; we just react to the webhook.



\## Definition of done



\- \[ ] `webhooks.app.uninstalled.tsx` deletes both `Session` rows and `MerchantConfig` rows for the shop.

\- \[ ] Deletion logic is structured so adding a new shop-scoped model is a single-line addition.

\- \[ ] Handler is idempotent (doesn't throw if the rows don't exist).

\- \[ ] Handler logs shop domain + what was deleted.

\- \[ ] Test: manually trigger the webhook via `shopify app webhook trigger` and verify both tables are cleaned for that shop.

\- \[ ] `npm run build` passes.

\- \[ ] `npm run lint` passes.

