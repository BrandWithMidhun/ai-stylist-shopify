# Feature 005a — Product Sync & Tagging Schema

**Status:** Draft
**Depends on:** 001 (MerchantConfig), 002 (uninstall cleanup), 003 (GDPR)
**Blocks:** 005b (AI tagging UI rework), 006 (Catalog Intelligence pipeline)
**Owner:** Midhun

---

## 1. Why

Feature 005 (AI tagging UI) shipped without a persistence layer. Products come from Shopify live, AI-generated tags have nowhere to be saved, and the UI appears broken because tagged products "vanish" on re-render. This spec adds the foundation: a local Product mirror, a ProductTag store, Shopify sync via webhooks, and the data primitives every subsequent feature (Catalog Intelligence, Rules engine, Human review, Chat agent retrieval) will build on.

The data model must be category-agnostic from day one — the same schema has to serve Fashion, Beauty, Furniture, Electronics, and any other vertical without migration.

## 2. Goals & Non-Goals

### Goals
- Mirror Shopify products into Postgres with enough fidelity to drive tagging, filtering, and recommendations.
- Store AI / Rule / Human tags with per-axis provenance and confidence.
- Stay in sync via webhooks, with a manual "Sync catalog" escape hatch.
- Unblock Feature 005b (tagging UI that actually persists) and Feature 006 (Catalog Intelligence).

### Non-Goals
- No taxonomy management yet — that lives in 006.
- No rules engine yet — `source='RULE'` is a reserved value but no rules run in 005a.
- No pgvector / embeddings yet — that's a 006 concern.
- No writeback to Shopify metafields yet — that's a 005b / 006 concern.
- No merchant-facing UI changes beyond what 005b needs.

## 3. Data Model

### 3.1 `Product`

Mirrors Shopify products. One row per product per shop.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | Internal ID |
| `shopDomain` | `String` | e.g. `ai-fashion-store.myshopify.com` |
| `shopifyId` | `String` | Shopify's GID, e.g. `gid://shopify/Product/123` |
| `handle` | `String` | URL slug |
| `title` | `String` | |
| `descriptionHtml` | `String?` | Full HTML description, for AI context |
| `productType` | `String?` | Shopify's native product type |
| `vendor` | `String?` | |
| `status` | `String` | `ACTIVE` / `DRAFT` / `ARCHIVED` (from Shopify) |
| `featuredImageUrl` | `String?` | CDN URL of primary image |
| `imageUrls` | `String[]` | All product image URLs (Postgres text array) |
| `priceMin` | `Decimal?` | Across all variants |
| `priceMax` | `Decimal?` | Across all variants |
| `currency` | `String?` | e.g. `INR` |
| `shopifyTags` | `String[]` | Shopify's merchant-set tags (not AI tags) |
| `totalInventory` | `Int?` | Sum across variants |
| `inventoryStatus` | `String` | `IN_STOCK` / `OUT_OF_STOCK` / `LOW_STOCK` — derived |
| `shopifyCreatedAt` | `DateTime` | From Shopify |
| `shopifyUpdatedAt` | `DateTime` | From Shopify |
| `syncedAt` | `DateTime @default(now())` | Last time we synced this row |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |

**Indexes:**
- `@@unique([shopDomain, shopifyId])` — primary lookup
- `@@index([shopDomain, status])` — list queries
- `@@index([shopDomain, inventoryStatus])` — stock filtering
- `@@index([shopDomain, productType])` — grouping for 006

**Relations:** `variants ProductVariant[]`, `tags ProductTag[]`

### 3.2 `ProductVariant`

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `productId` | `String` | FK → Product |
| `shopifyId` | `String` | Variant GID |
| `title` | `String` | e.g. "Small / Red" |
| `sku` | `String?` | |
| `price` | `Decimal` | |
| `compareAtPrice` | `Decimal?` | |
| `inventoryQuantity` | `Int?` | |
| `availableForSale` | `Boolean` | |
| `option1` / `option2` / `option3` | `String?` | e.g. Size, Color, Material |
| `imageUrl` | `String?` | Variant-specific image if any |
| `createdAt` / `updatedAt` | `DateTime` | |

`@@unique([productId, shopifyId])`
`@@index([productId])`

### 3.3 `ProductTag`

The core tagging table. One row per (product, axis) — so `source` is **per axis**, exactly matching the reference UI where `category` might be HUMAN-reviewed while `fit` is still AI-tagged.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `productId` | `String` | FK → Product |
| `shopDomain` | `String` | Denormalized for fast filtering |
| `axis` | `String` | e.g. `category`, `style`, `occasion`, `color_family`, `fit` |
| `value` | `String` | Single value. For multi-select axes, use multiple rows. |
| `confidence` | `Float?` | 0.0 – 1.0. Null for HUMAN source. |
| `source` | `String` | `AI` / `RULE` / `HUMAN` |
| `locked` | `Boolean @default(false)` | HUMAN edits lock this (product, axis) from AI/RULE overwrite |
| `metadata` | `Json?` | Reserved: which rule fired, which model version, etc. |
| `createdAt` | `DateTime @default(now())` | |
| `updatedAt` | `DateTime @updatedAt` | |

**Indexes:**
- `@@unique([productId, axis, value])` — same (axis, value) can't exist twice on one product
- `@@index([shopDomain, axis, value])` — fast "all products tagged occasion=wedding"
- `@@index([productId])` — fast "all tags for this product"
- `@@index([shopDomain, source])` — filter for Human-reviewed, AI-tagged counts

**Design note — single value per row:**
Multi-select axes (e.g. a product has `occasion = [casual, event, festive]`) are stored as three rows. This matches how pgvector / retrieval / faceted search will want the data later, and makes the `locked` flag per-value rather than per-axis. Trade-off: reads need a groupBy. Acceptable.

### 3.4 `ProductTagAudit` (optional for 005a, recommended)

Append-only log of every tag change. Small schema, pays off massively in debugging and in the 006 learning loop.

| Field | Type | Notes |
|---|---|---|
| `id` | `String @id @default(cuid())` | |
| `productId` | `String` | Not a FK — survives product deletion |
| `shopDomain` | `String` | |
| `axis` | `String` | |
| `action` | `String` | `ADD` / `REMOVE` / `LOCK` / `UNLOCK` |
| `previousValue` | `String?` | |
| `newValue` | `String?` | |
| `source` | `String` | `AI` / `RULE` / `HUMAN` / `SYSTEM` |
| `actorId` | `String?` | Shopify user ID for HUMAN edits |
| `createdAt` | `DateTime @default(now())` | |

`@@index([productId, createdAt])`
`@@index([shopDomain, createdAt])`

## 4. Sync Strategy

### 4.1 Initial Sync — Background on Install

- New webhook subscription added in 005a: `app/uninstalled` already exists; add an **installation hook** that triggers an initial sync job.
- On first OAuth completion for a shop, enqueue `syncCatalog(shopDomain)` — fire and forget.
- Uses Shopify Admin GraphQL `products` connection with cursor pagination, 100 products per page.
- Writes into Product + ProductVariant in transactions of ~50 products each.
- Stores `syncedAt` timestamp on MerchantConfig (`lastFullSyncAt`) so the UI can show "Last synced 15m ago".
- Idempotent — re-running re-upserts, doesn't duplicate.

### 4.2 Manual "Sync catalog" Button

- In the intelligence page header: `Sync catalog · Last synced {relativeTime}`
- Click → POST `/api/catalog/sync` → enqueues the same job, returns immediately with a jobId.
- UI polls job status (`GET /api/catalog/sync/:jobId`) every 2s, shows progress: `Syncing · 340 / 1187`.
- Disabled while a sync is already running for this shop.

### 4.3 Ongoing Sync — Webhooks

Subscribe on install:
- `products/create` → upsert Product + variants
- `products/update` → upsert Product + variants, mark any affected ProductTags for re-review if title/description changed significantly (defer: just bump `syncedAt` in 005a)
- `products/delete` → soft-delete Product (add `deletedAt` field), cascade-delete ProductTags, keep ProductTagAudit
- `inventory_levels/update` → update ProductVariant.inventoryQuantity, recompute Product.inventoryStatus

All webhooks HMAC-validated per Feature 003 pattern. All idempotent.

### 4.4 Reconciliation

A daily cron (`node-cron` in the Node backend, or Railway scheduled job):
- For each active shop, fetch product IDs from Shopify, diff against local Product rows.
- Delete locals that no longer exist in Shopify (catches missed webhooks).
- Re-sync any Shopify products whose `updated_at` is newer than local `syncedAt`.

Non-blocking for launch; can ship 005a without it and add in week 2.

## 5. API Surface (server-side, used by 005b)

```
POST   /api/catalog/sync                      → enqueue full sync, return { jobId }
GET    /api/catalog/sync/:jobId               → { status, progress, total }
GET    /api/catalog/stats                     → counts by status/inventory/tag-source
GET    /api/products?status=&inventory=&cursor → paginated product list with tags
GET    /api/products/:id                      → product + variants + all tags
POST   /api/products/:id/tags/generate        → call Claude, upsert AI tags (Feature 005b)
PUT    /api/products/:id/tags                 → bulk upsert (Human edits, locks axes)
POST   /api/products/tags/generate-batch      → parallel AI tagging with rate limit
```

All routes authenticate via Shopify session and scope everything by `shopDomain`.

## 6. 005b Rework (What Changes in the Existing UI)

The existing `/app/products/intelligence` page changes as follows — no new UI, just wiring the old one to real persistence:

### 6.1 Loader
Reads from local `Product` table (not Shopify live), joins `ProductTag` rows, groups tags by axis per product. Remove any "pending only" filter — show everything by default with status pills.

### 6.2 Row status pill (new)
Each product row shows one of:
- `Pending` — no tags exist
- `AI Tagged` — tags exist, all `source='AI'`
- `Rule Tagged` — at least one `source='RULE'` tag
- `Human Reviewed` — at least one `source='HUMAN'` tag (highest precedence badge)

### 6.3 "Generate tags" action
Writes to `ProductTag` with `source='AI'`. Respects the `locked` flag — never overwrites human-locked axes. After successful generation, row stays visible, pill flips to `AI Tagged`, tags render inline.

### 6.4 "Generate tags for all"
Parallelized with `p-limit` (concurrency: 5). Progress indicator. Per-product failure doesn't kill the batch — failed products stay `Pending`, errors logged.

### 6.5 Filter dropdown (new, simple)
Status filter: `All / Pending / AI Tagged / Human Reviewed`. Client-side filter for v1.

## 7. Migration Plan

1. Add schema to `prisma/schema.prisma`.
2. `npx prisma migrate dev --name add_product_and_tags`.
3. Seed dev store: trigger manual sync for `ai-fashion-store.myshopify.com` via a one-off script.
4. Verify in Prisma Studio: Product rows populated, ProductVariant rows populated, ProductTag empty (expected).
5. Wire 005b loader to new schema, deploy, test generate → tag persists → row stays visible with pill.

## 8. Open Questions

- **Variant-level tagging?** Deferred. 005a stores variants but tags only attach to Products. If a merchant wants variant-level ("this color is for summer, this color for winter"), revisit in 006.
- **Tag value normalization?** e.g. "minimal" vs "Minimal" vs "minimalist". Deferred to 006's taxonomy service — for now, store what Claude returns, normalize on read.
- **How do we handle a product that exists in ProductTag but was deleted in Shopify mid-sync?** The `products/delete` webhook will cascade-delete. If webhooks are missed, daily reconciliation catches it.

## 9. Acceptance Criteria

- [ ] Schema migrated, Prisma Studio shows Product / ProductVariant / ProductTag / ProductTagAudit tables.
- [ ] Manual "Sync catalog" button in intelligence page header works end-to-end.
- [ ] After sync, Product table contains all active + draft + archived products from the dev store.
- [ ] Variants populated with correct inventory quantities.
- [ ] `products/create` webhook tested (create a product in Shopify admin → appears in local DB within 10s).
- [ ] `products/update` webhook tested.
- [ ] `products/delete` webhook tested (soft-delete, ProductTags cascade).
- [ ] `inventory_levels/update` webhook tested.
- [ ] 005b loader reads from local DB, not live Shopify.
- [ ] "Generate tags" on a single product writes `ProductTag` rows with `source='AI'`, row stays visible, pill flips to `AI Tagged`.
- [ ] "Generate tags for all" processes batch with concurrency 5, no crashes on partial failure.
- [ ] `locked` flag respected — manually set a product's category tag to `source='HUMAN'`, `locked=true`, re-run AI, category doesn't change.
- [ ] Lint + typecheck + build all green.
- [ ] Deployed to Railway, verified on production URL.

## 10. Out of Scope (Explicitly)

- Taxonomy service / per-group attribute axes → Feature 006
- Rules engine ("if title contains X → category = Y") → Feature 006
- Review queue with confidence thresholds → Feature 006
- Vision-enabled tagging (images in Claude call) → Feature 006
- Embeddings / pgvector → Feature 006
- Feedback retrieval loop → Feature 006
- Eval harness → Feature 006
- Metafield writeback to Shopify → Feature 005c (small follow-up) or 006
- Storefront chat agent → Feature 007

---

*This spec intentionally does the boring foundation work so every subsequent feature in the roadmap can assume persistence, provenance, and sync-to-Shopify exist.*
