# Feature 005d — Product Edit Drawer & Per-Card Actions

**Status:** Draft
**Depends on:** 005a (schema), 005b (AI tagging), 005c (dashboard)
**Blocks:** 006 (Catalog Intelligence pipeline assumes human-review actions exist)
**Owner:** Midhun

---

## 1. Why

005c finished the merchant cockpit visually but left it half-functional. A merchant can see the dashboard, see tagged products, but has no way to:
- Trigger AI tagging on a single product from the card
- Edit any tag manually
- Mark a product as Human Reviewed (the act that lets `source = "HUMAN"` ever appear in the DB)

Without those, the "three sources" (AI / Rule / Human) story is fiction — the DB will only ever contain AI-source tags. The Human Reviewed stat card is permanently 0. The whole training/learning narrative breaks.

005d closes the loop: per-card action menu + side drawer for editing.

## 2. Goals & Non-Goals

### Goals
- Per-card 3-dot menu with: Generate tags / Mark Human Reviewed / Edit tags / Exclude (already exists, move into menu).
- Side drawer (slides from right) for editing all tag axes of a single product, matching reference screenshot 5.
- Single-product Generate tags that respects locked axes (already in 005b API, just wire the UI).
- Mark Human Reviewed action that locks current tags as HUMAN-source.
- Optimistic updates everywhere — drawer save, lock toggle, exclude, mark reviewed all feel instant.
- Rename the "AI/Rule tagged" stat card to clarify it's a coverage metric, not the filter target.

### Non-Goals
- No new schema fields. All tag mutations use existing ProductTag + ProductTagAudit.
- No multi-select / bulk actions — deferred to a later feature.
- No keyboard shortcuts in the drawer (J/K/A/E etc from reference) — defer to v2.
- No "high-confidence star" badge logic — for v1, every Human-Reviewed product gets the same badge. Star nuance defers to 006.
- No tag-value autocomplete from existing values — defer (typing free-text is OK for v1).
- No undo on save — merchants can re-edit, no undo stack.

## 3. UX Flow

### 3.1 Card menu (replaces current Exclude button placement)

Each ProductCard gets a 3-dot menu (`⋯`) in the top-right corner of the card body (below any "Out of stock" badge).

Click → dropdown with 4 items:
1. **Generate tags** — calls existing `POST /api/products/:id/tags/generate`. Spinner on the card while generating. Disabled when product has any locked tags AND all expected axes already have a value (nothing for AI to do).
2. **Mark Human Reviewed** — sets `locked=true, source="HUMAN"` on every existing tag for this product. Disabled when already marked. See §4.2.
3. **Edit tags** — opens the side drawer. See §4.1.
4. **Exclude / Include** — toggles `recommendationExcluded`. Label flips based on current state.

Component: `app/components/catalog/ProductCardMenu.tsx`. Uses `<s-popover>` if Polaris supports anchored popovers; fallback is a custom positioned div with click-outside-to-close.

### 3.2 Drawer (slides from right)

Triggered from "Edit tags" menu item. Layout matches reference screenshot 5:

```
┌──────────────────────────────────────────────────────────┐
│  [thumbnail] Marvel - Full Sleeve Mandarin    [×]       │
│              Collar Pure Linen Mid Kurta                │
│              👤 Human · 100% conf                       │
│                                                          │
│  💡 Human-curated — edits are logged and lock this      │
│     product from AI overwrite.                          │
│                                                          │
│  Gender                                                  │
│  [male ▼]                                                │
│                                                          │
│  Category                                                │
│  [kurta ▼]                                               │
│                                                          │
│  Sub-category                                            │
│  [linen kurta              ]                             │
│                                                          │
│  Fit                                                     │
│  [regular ▼]                                             │
│                                                          │
│  Colour family                                           │
│  [white ▼]                                               │
│                                                          │
│  Occasion                                                │
│  [work] [casual] [travel] [event] [formal] [festive]   │
│   ───   ─────                  ───   ─────  ─────       │
│   selected (filled)         unselected (outline)        │
│                                                          │
│  Style type                                              │
│  [minimal] [classic] [relaxed] [bold] [preppy] ...      │
│                                                          │
│  Statement piece                                         │
│  [ Not a statement piece ]                               │
│                                                          │
│  Recommendations                                         │
│  [ ✓ Included in looks ]                                 │
│                                                          │
├──────────────────────────────────────────────────────────┤
│        [Save changes]    [Reset]    [Cancel]             │
└──────────────────────────────────────────────────────────┘
```

Field types per axis:
- **Single-value enum** (gender, category, fit, colour_family, statement_piece): dropdown
- **Multi-value enum** (occasion, style_type): chip toggles (click to add/remove)
- **Free text** (sub_category): text input

The dropdown options come from a per-storeMode constant. Reuse the `STARTER_AXES` from `store-axes.ts` and extend it with allowed values per axis. New file: `app/lib/catalog/axis-options.ts` with shape:

```ts
{
  fashion: {
    gender: { type: "single", values: ["male", "female", "unisex"] },
    category: { type: "single", values: ["shirt", "kurta", "pants", "..."] },
    occasion: { type: "multi", values: ["work", "casual", "travel", "event", "formal", "festive"] },
    sub_category: { type: "text" },
    ...
  },
  electronics: { ... },
  furniture: { ... },
  beauty: { ... },
  general: { ... }
}
```

The drawer reads `storeMode` from MerchantConfig (already in loader), reads the relevant axis options, and renders fields dynamically. Extending to a new vertical = adding one entry to this constant.

### 3.3 Drawer save behavior

Click Save:
1. Optimistic close drawer immediately
2. Optimistic update of the card's pill (Pending/AI Tagged → Human Reviewed)
3. Optimistic update of inline tag chips
4. Background `PUT /api/products/:id/tags` with the new tag set, `source="HUMAN"`, `locked=false` per current 005a default
5. On 200: revalidate loader so stats refresh
6. On error: revert optimistic state, show toast "Couldn't save changes — try again"

Reset: returns drawer to the values of existing tags in DB (drops unsaved edits).
Cancel: closes without saving.

### 3.4 Mark Human Reviewed action

Selected from card menu OR inside drawer (separate "Mark all reviewed" button at top of drawer — see §4.1).

What it does:
- For every existing tag on this product: keep value, change source to "HUMAN", set locked=true
- Single ProductTagAudit row with `action="MARK_REVIEWED"`, `source="HUMAN"`, `metadata` encoding the original sources
- After: card pill flips to Human Reviewed (with star indicator if locked)

This is the action that makes the Human Reviewed stat card finally able to be non-zero.

API: new `POST /api/products/:id/mark-reviewed`. Body empty. Idempotent — calling twice is safe.

## 4. API Surface Changes

### 4.1 New POST `/api/products/:id/mark-reviewed`

Body: `{}`
Behavior:
- For all ProductTags where `productId = :id AND shopDomain = session.shop`:
  - Set `source = "HUMAN"`, `locked = true`
- Write one ProductTagAudit row with `action="MARK_REVIEWED"`, `source="HUMAN"`, `metadata` (encoded into existing fields per the 005c audit-encoding pattern, until the metadata column is added)
- Return `{ ok: true, tagsUpdated: number }`

Auth: admin session. Scope: `where: { productId, product: { shopDomain: session.shop } }` (joins through the relation).

### 4.2 Existing PUT `/api/products/:id/tags` — clarify default

The 005c handler writes HUMAN edits with `locked=false` (per the decision earlier in this thread). Confirmed correct — Mark Human Reviewed is a separate explicit action that locks; ordinary edits don't auto-lock.

But add this: when a single axis is edited via the drawer's normal save (not "Mark Reviewed"), the new tag should be source="HUMAN", locked=false. If the merchant wants to lock specific axes from AI overwrite, they use Mark Human Reviewed (locks all) or a future per-axis lock toggle (deferred).

No code change needed — the existing handler already does this. Just confirming intent in the spec.

### 4.3 Update `/api/catalog/stats` — rename label

The "AI/Rule tagged" stat card is misleading because it counts products with any AI/RULE tag *including* products that also have HUMAN tags. The filter "AI tagged" uses strict priority. Rename:

- Old card label: `AI/Rule tagged` (count = aiOrRuleTagged, no semantics change)
- New card label: `AI/Rule generated` with subtitle `coverage metric`

Or more cleanly:
- Card: `Tag coverage` showing `(totalProducts - pendingTag) / totalProducts` as a percentage AND the absolute count
- Old separate AI-only count goes to a tooltip on the stat card

Pick the simpler one. My preference: keep the card, just change the label string. Avoid restructuring.

## 5. Component Changes

### 5.1 New: `app/components/catalog/ProductCardMenu.tsx` (~80 lines)

3-dot trigger + dropdown with 4 items. Props:
```ts
{
  product: ProductListItem;
  pendingTagAxes: string[];  // for disabling Generate when none missing
  onGenerate: () => void;
  onMarkReviewed: () => void;
  onEdit: () => void;
  onToggleExclude: () => void;
}
```

### 5.2 New: `app/components/catalog/ProductEditDrawer.tsx` (~180 lines, watch the 200-line rule)

Slides in from right via CSS transform. Uses:
- `<s-stack>` for vertical layout
- Field components per axis type (Dropdown/ChipGroup/TextField)
- Footer with Save/Reset/Cancel

Props:
```ts
{
  product: ProductListItem;
  storeMode: StoreMode;
  open: boolean;
  onClose: () => void;
  onSaved: (updatedTags: TagListItem[]) => void;
}
```

Internal state: `{ draftTags: Map<axis, value | string[]> }`. Initialized from product.tags.

If the file exceeds 200 lines, extract:
- `app/components/catalog/drawer/AxisField.tsx` (renders the right control per axis type)
- `app/components/catalog/drawer/DrawerFooter.tsx`

### 5.3 New: `app/lib/catalog/axis-options.ts` (~120 lines)

Per-storeMode axis definitions with allowed values. Single source of truth — `ai-tagger.server.ts` should also import from this module so AI tagging and human editing share the same vocabulary.

Refactor: `STARTER_AXES` in `store-axes.ts` becomes a derived view (just the axis names) over `AXIS_OPTIONS` (this new file). `store-axes.ts` re-exports the derived list.

### 5.4 Modify: `ProductCard.tsx`

Replace the standalone Exclude button with `<ProductCardMenu>`. Add the spinner state for in-progress single-tag generation. Add a "drawer open" trigger callback.

### 5.5 Modify: `Dashboard.tsx`

Manage drawer-open state at the dashboard level (which product is being edited). Render `<ProductEditDrawer>` once at the dashboard level — only one drawer open at a time.

When drawer saves successfully, call `revalidator.revalidate()` to refresh stats + cards.

### 5.6 Modify: `StatCard.tsx` or workflow bar

If we're renaming the "AI/Rule tagged" label, update the stat card definitions in Dashboard. Per §4.3, simplest change: just rename the string.

## 6. Implementation Order

Each step ends with green lint/typecheck/build, independently committable.

1. **axis-options.ts** + refactor `store-axes.ts` to derive from it.
2. **POST /api/products/:id/mark-reviewed** route + tests.
3. **ProductCardMenu** component, replace Exclude button placement.
4. Wire **Generate tags** menu item to existing API.
5. Wire **Mark Human Reviewed** menu item to new API.
6. **ProductEditDrawer** component with axis fields (single/multi/text).
7. Wire drawer open/close state in Dashboard, save flow with optimistic updates.
8. **Drawer save** API integration via existing `PUT /api/products/:id/tags`.
9. Rename "AI/Rule tagged" stat card label per §4.3.
10. Verification pass.

## 7. Acceptance Criteria

- [ ] Each product card has a 3-dot menu in the top-right.
- [ ] Menu items: Generate tags / Mark Human Reviewed / Edit tags / Exclude (or Include if already excluded).
- [ ] Click Generate tags → spinner on card, AI runs, tags appear, pill flips appropriately, no full-page reload.
- [ ] Click Mark Human Reviewed on an AI-tagged product → all tags converted to source="HUMAN", locked=true. Pill flips to Human Reviewed. Stat card "Human reviewed" increments.
- [ ] Mark Human Reviewed disabled (or hidden) when product already in human_reviewed status.
- [ ] Click Edit tags → drawer slides in from right within 200ms.
- [ ] Drawer shows correct axis fields for the merchant's storeMode.
- [ ] Drawer pre-fills all current tag values.
- [ ] Multi-value axes (occasion, style_type) render as chip toggles, not dropdowns.
- [ ] Single-value axes render as dropdowns.
- [ ] Free-text axes render as text inputs.
- [ ] Drawer Save button: closes drawer, updates card optimistically, persists to DB, reloads stats.
- [ ] Drawer Reset: re-fills with DB values, drops unsaved edits.
- [ ] Drawer Cancel: closes without changes.
- [ ] Save error → toast appears, drawer state reverts.
- [ ] Edit on a product → tags become source="HUMAN", locked=false (not auto-locked unless Mark Reviewed pressed).
- [ ] Exclude button moved into menu, still works, card fades on excluded.
- [ ] Stat card relabeled per §4.3.
- [ ] No new schema fields added.
- [ ] Lint + typecheck + build green.
- [ ] Deployed to Railway, verified end-to-end on production URL.

## 8. Open Questions

1. **Drawer width.** Reference screenshot is ~480px. Polaris doesn't have a standard drawer primitive that I know of — implement as a fixed-positioned `<s-section>` with CSS transform animation? Or use App Bridge's modal as a slide-in? Verify during implementation.
2. **3-dot menu primitive.** Polaris `<s-popover>` exists but may not have an anchored-to-trigger position out of the box. Fallback: custom div with absolute positioning + click-outside hook.
3. **Multi-value chip toggles.** Reference screenshot shows occasion chips with filled (selected) vs outlined (unselected). Polaris `<s-chip>` may not have this two-state prop. Fallback: button with conditional `variant`.
4. **What happens to confidence on HUMAN edits?** Spec says null per 005a. Reference screenshot shows "100% conf" for a Human-source tag. Pick: keep null (technically accurate — humans don't have model confidence) or set to 1.0 for display purposes. I'd say null; UI shows "100% conf" only when source=HUMAN as a UX choice.
5. **Mark Reviewed on a Pending product (no tags).** No-op? Or refuse? I'd say: the menu item is disabled for Pending products since there's nothing to lock. Confirm.
6. **Tag value normalization.** If the merchant types "Casual" in a free-text field but the existing AI tags use "casual" (lowercase), does the drawer treat them as the same value? Per 005a §8, normalization is deferred to 006. So: store what the merchant types verbatim. Two near-identical tags can coexist for now.
7. **Axis ordering in the drawer.** Reference screenshot ordering: Gender, Category, Sub-category, Fit, Colour family, Colour tone, Primary colour, Occasion, Style type, Role, Climate, Statement piece, Recommendation. Should we match this exactly per storeMode, or define our own order in `axis-options.ts`? I'd define our own — match the reference for fashion, but for other modes use sensible per-vertical orders.
8. **Drawer mobile responsiveness.** On mobile, slide-in-from-right may be visually cramped. Switch to full-screen modal on small viewports? Or accept the cramped drawer? I'd accept v1, fix in v2.

## 9. Out of Scope

- Bulk operations (multi-select cards, bulk Mark Reviewed) → later
- Keyboard shortcuts in drawer → v2
- Per-axis lock toggles (only "Mark all reviewed" locks for now) → 006
- Star/high-confidence badges → 006
- Tag value autocomplete from existing catalog values → later
- Undo stack → not planned
- Drawer mobile-specific full-screen mode → v2
- Real-time confidence display per tag → 006

---

*005d closes the merchant cockpit. After this ships, the dashboard stops being read-only and becomes the actual review workspace the reference screenshots promise.*
