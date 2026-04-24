# Feature 005c — Intelligence Dashboard (3-State UI)

**Status:** Draft
**Depends on:** 005a (product sync + schema), 005b (basic intelligence page + AI tagging)
**Blocks:** 006 (Catalog Intelligence pipeline uses this dashboard as its home)
**Owner:** Midhun

---

## 1. Why

The current `/app/products/intelligence` page is a 2-state UI (empty state + product list). It's too thin for the merchant experience we want and doesn't match the reference design. This feature upgrades it to the dashboard shown in the reference screenshots: stats overview, persistent guide, full filter panel, and a dedicated full-page sync experience.

The work is pure UI + loader + small config additions. No schema changes. No new tagging logic.

## 2. Goals & Non-Goals

### Goals
- Three distinct UI states based on sync + job status: **Empty**, **Syncing (full-page takeover)**, **Dashboard**.
- Dashboard matches reference screenshots: 8 stats cards, persistent guide block, filter sidebar, product grid with status pills and exclude toggle.
- Re-syncs use a toast/banner pattern (non-blocking) while first-sync uses full-page takeover.
- Merchant can navigate away during sync — sync continues, progress resumable on return.

### Non-Goals
- No schema changes for tagging (all 005a fields stay as-is).
- No rules engine — `Rule Tagged` pill and `Active rules` card render with value 0 for now, with a subtle "Coming in 006" hint.
- No product edit drawer — clicking a product card does nothing until Feature 005d.
- No "Generate tags for all" implementation change — existing batch button stays; we just restyle it.
- No guide dismissal in this feature (decision: always visible per your answer). Dismissal can come later if needed.

## 3. The Three States

### 3.1 State logic (loader-side)

```
if (merchantConfig.lastFullSyncAt == null) {
  if (isSyncJobActive(shop)) {
    return { mode: "SYNCING_FIRST_TIME", jobId, progress, total }
  }
  return { mode: "EMPTY" }
}

// lastFullSyncAt is set
if (isSyncJobActive(shop)) {
  return { mode: "DASHBOARD_WITH_RESYNC_TOAST", ...dashboardData, jobId, progress, total }
}
return { mode: "DASHBOARD", ...dashboardData }
```

Three branches: Empty, Syncing (first time only, full takeover), Dashboard (normal + optional resync toast).

### 3.2 State transitions

```
EMPTY ──click Sync──▶ SYNCING_FIRST_TIME ──complete──▶ DASHBOARD
                                                          │
                                                          ├── click Sync ──▶ DASHBOARD_WITH_RESYNC_TOAST
                                                          │                     │
                                                          │                  complete
                                                          │                     │
                                                          └◀────────────────────┘
```

## 4. State 1 — EMPTY (Fresh Install)

Same as today. Re-using the existing `EmptyCatalogState` component. No changes required. Just confirm the component is rendered when `mode === "EMPTY"`.

## 5. State 2 — SYNCING_FIRST_TIME (Full-Page Takeover)

Replaces the entire main area of the page. No dashboard, no nav distractions. The merchant sees:

### 5.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                  [ animated icon / spinner ]                │
│                                                             │
│            Syncing your Shopify catalogue                   │
│                                                             │
│   We're mirroring your products so the AI stylist can      │
│   tag, group, and recommend them. You can close this       │
│   tab — sync will continue in the background.              │
│                                                             │
│            ┌─────────────────────────────────┐              │
│            │ ████████████░░░░░░░░  340/1187 │              │
│            └─────────────────────────────────┘              │
│                                                             │
│                    29% complete                             │
│                                                             │
│              Phase: Reading from Shopify                    │
│                                                             │
│      Estimated time remaining: about 2 minutes              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Behavior

- Polls `GET /api/catalog/sync/:jobId` every 2 seconds.
- Progress bar fills as `progress / total`.
- Phase text derived from progress:
  - `progress === 0`: "Counting your catalogue"
  - `0 < progress < total`: "Reading from Shopify"
  - `progress === total && status === "running"`: "Finalising"
  - `status === "succeeded"`: trigger transition to DASHBOARD
- Estimated time remaining: rolling average of last 10 progress intervals, rounded to nearest minute, minimum "under a minute".
- **User can navigate away.** If they return to the page mid-sync, the loader re-detects the active job and re-renders this screen.
- **User can close the tab.** Sync is server-side, persists in memory for the life of the process. (Note: Railway restart kills in-memory state; sync is idempotent so re-click just re-syncs. Acceptable trade-off per 005a spec.)
- On completion: smooth fade to DASHBOARD. Toast at top-right: "Synced 1187 products · 23 seconds".
- On failure: full-page error screen with retry button. Same layout, error message in red, retry re-POSTs `/api/catalog/sync`.

### 5.3 Component

New component: `app/components/catalog/SyncInProgress.tsx`.

Props:
```ts
{
  progress: number;
  total: number;
  status: "running" | "succeeded" | "failed";
  startedAt: string; // ISO, for elapsed time calc
  error?: string;
  onRetry: () => void;
}
```

Uses Polaris `s-progress-indicator` or a custom styled bar if Polaris doesn't support percentage bars cleanly (check docs during implementation — fallback is a div with width % inline style).

## 6. State 3 — DASHBOARD (The Main View)

The full merchant dashboard. Matches reference screenshots as closely as Polaris allows.

### 6.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Product Intelligence                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐│
│  │ 1187   │ │ 464    │ │ 722     │ │ 1      │ │ 0        │ │ 1168     ││
│  │ Total  │ │ ● Live │ │🔻OutStk │ │📦 Draft│ │📇 Pending│ │⚙ AI/Rule ││
│  └────────┘ └────────┘ └─────────┘ └────────┘ └──────────┘ └──────────┘│
│  ┌────────────────┐ ┌──────────────┐                                    │
│  │ 19 Human rev.  │ │ 0 Active ru. │   (greyed, "Coming in 006")       │
│  └────────────────┘ └──────────────┘                                    │
│                                                                          │
├─────────────────────────────────────────────────────────────────────────┤
│ 🎓 How to build great Product Intelligence · 100% of catalogue tagged  │
│                                                                          │
│ (Guide content — 4 step cards, filter legend — see 6.3)                │
├─────────────────────────────────────────────────────────────────────────┤
│ MAIN WORKFLOW                                                            │
│ [🧠 Tag with AI (none pending)]  [✓ All tagged]                         │
│ [Grid] [Grouped] [Rules (9)] [Settings]                                 │
│                                                                          │
│ REFINE                                                                   │
│ [Apply Rules] [Train System]   CATALOG [Sync Stock · Last synced 15m]  │
│                                                          [Reset tags ▼] │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐  ┌─────────────────────────────────────────────────────┐ │
│ │ FILTERS  │  │ 🔍 Search products by name...                       │ │
│ │          │  │                                                     │ │
│ │ Gender   │  │ Showing 500 products (limit 500 — refine to see)   │ │
│ │ [All ▼]  │  │                                                     │ │
│ │          │  │ ┌──────────┐ ┌──────────┐ ┌──────────┐             │ │
│ │ Type     │  │ │ [image]  │ │ [image]  │ │ [image]  │             │ │
│ │ [All ▼]  │  │ │          │ │          │ │          │             │ │
│ │          │  │ │ Title... │ │ Title... │ │ Title... │             │ │
│ │ Colour   │  │ │ 👤 Human │ │ 👤 Human │ │ 👤 Human⭐│             │ │
│ │ [All ▼]  │  │ │ tags...  │ │ tags...  │ │ tags...  │             │ │
│ │          │  │ │ [Exclude]│ │ [Exclude]│ │ [Exclude]│             │ │
│ │ Status   │  │ └──────────┘ └──────────┘ └──────────┘             │ │
│ │ All 1187 │  │                                                     │ │
│ │ Pending 0│  │ ...                                                 │ │
│ │ ...      │  │                                                     │ │
│ └──────────┘  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Stats cards (8)

Each card is a `<s-box>` with:
- Large number (32px, bold)
- Label (small, muted)
- Optional icon/emoji
- Optional tone (for visual distinction per reference: Total neutral, Live green, Out of Stock red, etc.)

| Card | Value source | Notes |
|---|---|---|
| Total | `product.count({ where: deletedAt: null })` | neutral |
| Live | `product.count({ where: status: ACTIVE, inventoryStatus: IN_STOCK \|\| LOW_STOCK })` | green dot |
| Out of Stock | `product.count({ where: inventoryStatus: OUT_OF_STOCK })` | red |
| Draft | `product.count({ where: status: DRAFT })` | neutral |
| Pending tag | `product.count({ where: tags: none })` | neutral |
| AI / Rule tagged | `product.count({ where: any tag.source in [AI, RULE] })` | blue |
| Human reviewed | `product.count({ where: any tag.source = HUMAN })` | green |
| Active rules | `0` (rules engine is 006) | greyed, tooltip "Coming in 006" |

All counts computed in the loader via Prisma `groupBy` or parallel `count()` calls wrapped in `Promise.all`. Cached per-request, no separate caching layer.

Component: `app/components/catalog/StatCard.tsx` — props `{ label, value, tone?, icon?, hint? }`.
Container: `app/components/catalog/StatsRow.tsx` — renders the 8 cards in a responsive grid (4 cols on desktop, 2 on tablet, 1 on mobile).

### 6.3 Guide section (always visible)

Matches reference screenshot 1 exactly. Component: `app/components/catalog/IntelligenceGuide.tsx`.

Structure:
- Header bar: `🎓 How to build great Product Intelligence · {tagged}% of catalogue tagged`
- Intro paragraph
- 4 step cards in a 2×2 grid (or 4×1 on desktop wide):
  1. Auto-tag with AI
  2. Review & correct
  3. Train the system
  4. Keep stock fresh
- Filter legend panel below: explains Occasion, Category, Style type, Fit, Statement piece

**For features not yet built** (Train system, Review queue, Stock sync cron): the step cards render but their CTAs are disabled with tooltip "Coming in Feature 006". The copy stays, so merchants see the full vision.

The guide is always visible — no dismiss for now per your answer.

### 6.4 Workflow bar

Row 1 — `MAIN WORKFLOW`:
- Primary CTA: `🧠 Tag with AI ({pending} pending)` — disabled if pending = 0, shows `✓ All products tagged` badge
- View toggle: `Grid` (active) / `Grouped` (disabled, 006)
- `Rules ({count})` button — disabled, badge "0"
- `Settings` button — navigates to existing `/app/config` route

Row 2 — `REFINE`:
- `Apply Rules` — disabled, tooltip "Coming in 006"
- `Train System` — disabled, tooltip "Coming in 006"
- `CATALOG · Sync Stock · Last synced {relativeTime}` — re-fires the sync job (becomes the resync toast pattern, not full-page takeover)
- `Reset tags ▼` — dropdown, options: "Reset AI tags" / "Reset all tags (keep human)" / "Reset everything". Each shows a confirm dialog, then calls existing `PUT /api/products/:id/tags` endpoints batched server-side (new route: `POST /api/catalog/tags/reset` — specified below).

### 6.5 Filter sidebar

Component: `app/components/catalog/FilterSidebar.tsx`.

Dropdowns (client-side filter, server-side for v2):
- Gender
- Product type
- Colour family
- Status: radio list — All / Pending / Any Tagged / AI Tagged / Rule Tagged / Human Reviewed (counts shown)
- Statement: dropdown
- Stock status: radio list — All / Live / Out of Stock / Draft / Archived
- Recommendations: radio list — All / Included / Excluded

Values populated from:
- Gender, Colour family: derived from existing tag values in the catalog (`tag.findMany({ distinct: ['value'], where: { axis: 'gender' } })`)
- Product type: `product.findMany({ distinct: ['productType'] })`
- Rest: static enums

For v1, filters apply client-side over the loaded products. For v2 (future), move to server-side URL params.

### 6.6 Product grid

Component: `app/components/catalog/ProductCard.tsx`.

Each card:
- Product image (featuredImageUrl, fallback gray box if null)
- Out of stock badge (top-right, if inventoryStatus = OUT_OF_STOCK)
- Title (truncated, 2 lines)
- Source pill (Human / AI / Rule / Pending) per current 005b logic
- Inline tags (up to 4 chips: category, fit, colour, occasion — order by axis priority)
- Progress bar (thin, green) showing % of expected axes tagged — visual cue of completeness
- Exclude button (toggles `recommendationExcluded` flag — new field, see 7)

Grid: 3 cols desktop, 2 tablet, 1 mobile. Infinite scroll or "Load more" button (pick "Load more" for simplicity v1 — 500 per load, server-side cursor from 005a already supports).

Interaction: clicking a product card does nothing in 005c. Feature 005d will attach the edit drawer.

## 7. Schema Additions (Minimal)

One new field on Product:

| Field | Type | Notes |
|---|---|---|
| `recommendationExcluded` | `Boolean @default(false)` | Merchant-flagged "don't recommend this product" |

Migration name: `add_recommendation_excluded_flag`.

Also one optional field on MerchantConfig (defer if time-pressed):

| Field | Type | Notes |
|---|---|---|
| `intelligenceGuideDismissedAt` | `DateTime?` | Nullable. Reserved for future dismissal — not used in 005c. |

Decision: skip this field for 005c since guide is always-visible. Add in a later feature when we actually implement dismissal.

## 8. API Surface Changes

### 8.1 Enhance `GET /api/catalog/stats`

Add to the existing response (already scoped in 005a spec §5 but not fully implemented):

```ts
{
  totalProducts: number,
  live: number,
  outOfStock: number,
  draft: number,
  archived: number,
  pendingTag: number,
  aiOrRuleTagged: number,
  humanReviewed: number,
  activeRules: 0, // always 0 until 006
  lastFullSyncAt: string | null,
  tagCoveragePercent: number, // for guide header
  filterOptions: {
    genders: string[],
    productTypes: string[],
    colourFamilies: string[]
  }
}
```

Loader calls this endpoint on dashboard render. All counts in parallel (Promise.all).

### 8.2 New `POST /api/catalog/tags/reset`

Body:
```ts
{ scope: "ai_only" | "all_except_human" | "everything" }
```

Deletes matching ProductTag rows, writes ProductTagAudit entries with `source=SYSTEM, action=REMOVE`. Rate-limited to 1 reset per shop per 60 seconds. Returns count of deleted tags.

### 8.3 New `PATCH /api/products/:id/exclude`

Body:
```ts
{ excluded: boolean }
```

Sets `product.recommendationExcluded`. No audit logging for this field (doesn't affect tags).

## 9. Re-sync as Toast (Not Full Takeover)

When `lastFullSyncAt` is set and merchant clicks `Sync Stock` in the workflow bar:

1. POST `/api/catalog/sync` (existing)
2. UI shows a toast at top-right: `Syncing catalogue · 340 / 1187`
3. Toast updates every 2s as progress advances
4. On completion: toast becomes `✓ Synced 1187 products · 23s` with dismiss button
5. On failure: toast becomes `✗ Sync failed — retry` with retry button

Dashboard stats auto-refresh on toast completion (`useRevalidator()`).

Component: `app/components/catalog/SyncToast.tsx`. Mounted conditionally in dashboard mode when an active job exists.

## 10. Implementation Order

Each step ends with green lint/typecheck/build.

1. **Schema + migration** (add `recommendationExcluded` field; skip guide dismissal field).
2. **Stats API** — implement/enhance `GET /api/catalog/stats` with all counts + filter options.
3. **Dashboard shell** — restructure `app/routes/app.products.intelligence.tsx` to branch on the 3 modes.
4. **StatsRow + StatCard** components.
5. **IntelligenceGuide** component.
6. **Workflow bar** components.
7. **FilterSidebar** + client-side filter logic.
8. **ProductCard** — restyle existing row to match reference.
9. **SyncInProgress** full-page component + polling hook.
10. **SyncToast** + resync flow.
11. **Reset tags** API + dropdown wiring.
12. **Exclude** API + button wiring.
13. **Verification pass** against spec §11.

Each step is independently committable.

## 11. Acceptance Criteria

- [ ] Fresh install (`lastFullSyncAt IS NULL`, no active job) → renders EMPTY state (no change from 005a).
- [ ] Click Sync on empty → transitions to SYNCING_FIRST_TIME full-page takeover within 1s.
- [ ] Progress bar fills as sync advances, phase text updates, elapsed + ETA reasonable.
- [ ] Navigate away during sync, come back → page re-renders SYNCING_FIRST_TIME correctly.
- [ ] On sync complete → transitions to DASHBOARD with toast "Synced N products · Ts".
- [ ] Dashboard shows 8 stats cards with correct values matching Prisma counts.
- [ ] Active rules card shows 0 with "Coming in 006" tooltip.
- [ ] Guide section renders with correct `{tagged}%` in header.
- [ ] Guide step cards render; disabled CTAs show "Coming in 006" tooltip.
- [ ] Workflow bar: `Tag with AI (N pending)` reflects accurate count; disabled when 0.
- [ ] `Last synced {relativeTime}` text updates correctly ("15 minutes ago" etc).
- [ ] Filter sidebar dropdowns populated from real data.
- [ ] Status filter changes product grid to show only matching products.
- [ ] Product cards render: image, title, pill, tags, exclude button.
- [ ] Exclude button toggles `recommendationExcluded`, card gets visual treatment (faded).
- [ ] Reset tags dropdown: all 3 scopes work, confirm dialogs shown, counts returned.
- [ ] Re-sync from dashboard → toast appears (not full-page), dashboard remains interactive, stats refresh on completion.
- [ ] Sync failure → SYNCING_FIRST_TIME shows error + retry; toast version shows error + retry.
- [ ] Responsive: 3-col grid collapses to 2 on tablet, 1 on mobile.
- [ ] Lint + typecheck + build all green.
- [ ] Deployed to Railway, verified on production URL.

## 12. Out of Scope

- Rules engine UI (disabled buttons only) → 006
- Train System implementation → 006
- Grouped view → 006
- Product edit drawer (click-to-edit) → 005d
- Server-side filtering via URL params → later
- Guide dismissal (always-visible per user decision) → later
- Per-tag confidence display on product card → 006
- Stock sync cron → 006

---

*005c is pure polish + structure. No new tagging logic, no schema churn beyond one flag. Build it right once and 006 has a home to plug into.*
