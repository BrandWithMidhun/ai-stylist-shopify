\# Feature 001: Merchant Configuration Page



\## Purpose



The merchant config page is the first admin page a merchant sees after installing the AI Stylist app. It lets them configure the app's behavior for their store: which mode to run in (fashion, general commerce, etc.), which features to enable, and how the Add-to-Cart CTA looks.



One merchant = one config record. Config is keyed to the Shopify `shop` domain (from the session).



\## Data model: MerchantConfig



Add a new Prisma model `MerchantConfig` with these fields:



\- `id` — String, cuid, primary key

\- `shop` — String, unique (the shop domain like `ai-stylist-dev.myshopify.com`)

\- `storeMode` — Enum: `FASHION`, `ELECTRONICS`, `FURNITURE`, `BEAUTY`, `GENERAL`. Default `GENERAL`.

\- `chatWidgetEnabled` — Boolean, default `true`

\- `ctaEnabled` — Boolean, default `true`

\- `ctaLabel` — String, default `"Need help choosing?"`, max 60 chars

\- `ctaPlacement` — Enum: `PRODUCT\_PAGE`, `GLOBAL`, `COLLECTION`. Default `PRODUCT\_PAGE`.

\- `quizEnabled` — Boolean, default `true`

\- `lookbookEnabled` — Boolean, default `false` (fashion-only feature)

\- `stylistAgentEnabled` — Boolean, default `false`

\- `commerceAgentEnabled` — Boolean, default `true`

\- `createdAt` — DateTime, default `now()`

\- `updatedAt` — DateTime, `@updatedAt`



\## Routes and behavior



\- Route: `app/routes/app.config.tsx`

\- It replaces the current starter page as the "home" of the app. Update the left-nav (the `app/routes/app.tsx` layout) so "Configuration" is the primary nav item. Keep the existing starter page accessible under a secondary nav link called "Starter demo" so we can reference it later but it's not in the user's face.

\- The loader: authenticate via `shopify.authenticate.admin(request)`, then read the shop's `MerchantConfig` from the DB via `session.shop`. If no config exists, return default values (but do NOT write a record yet — only write on first save).

\- The action: accept a form submission, upsert the `MerchantConfig` record keyed on `shop`, return the updated record. Use zod for server-side validation of the form data.

\- The page: a Polaris web components form with:

&#x20; - A dropdown for `storeMode`

&#x20; - Toggles for each boolean feature

&#x20; - A text input for `ctaLabel` with live char counter

&#x20; - A dropdown for `ctaPlacement`

&#x20; - A Save button (disabled if form is unchanged)

&#x20; - A success toast on save

&#x20; - Graceful error state if the action throws



\## UX rules



\- Use Polaris web components only (`<s-page>`, `<s-section>`, `<s-select>`, `<s-text-field>`, `<s-button>`, `<s-toast>`, etc.). No raw HTML form elements, no Tailwind, no custom CSS.

\- Wrap form sections in `<s-section>` with clear headings: "Store type", "Features", "CTA configuration".

\- Show a single-line description under each toggle explaining what it does.

\- The lookbook toggle should be visually disabled (but still visible) when `storeMode` is not `FASHION`, with a tooltip: "Lookbook is a fashion-only feature."



\## Out of scope (for this feature)



\- No image upload, no actual chat widget, no agent logic, no analytics. This is config only.

\- No per-shop theme customization. That comes later.

\- No bulk merchant administration (we're not building a super-admin panel).



\## Definition of done



\- \[ ] Prisma migration applied locally and committed

\- \[ ] Route accessible at `/app/config` inside the dev store

\- \[ ] Form saves successfully and persists across page reloads

\- \[ ] All 5 store modes selectable

\- \[ ] Lookbook toggle correctly disables when store mode ≠ FASHION

\- \[ ] `npm run lint` passes

\- \[ ] `npm run build` passes with no TypeScript errors

\- \[ ] Feature works on both first-time shop (no existing config) and subsequent edits

