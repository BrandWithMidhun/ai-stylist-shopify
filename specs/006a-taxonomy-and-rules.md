# Feature 006a — Taxonomy + Rules Foundation

**Status:** Draft
**Depends on:** 005a-d
**Blocks:** 008 (agent orchestrator), 010 (stylist agent), 014 (lookbook)
**Owner:** Midhun

---

## 1. Why

005a-d gave merchants a polished cockpit but left two gaps that block the agent layer (008/010/014):

1. **No category hierarchy.** Tags live at a flat per-storeMode level. The stylist agent needs to know "kurta IS-A top, top PAIRS-WITH bottom" to compose outfits. Without a tree, the agent can't reason structurally.
2. **No deterministic data quality controls.** Every tag comes from one of two places: AI inference (noisy) or human edit (slow). Rules are how a merchant encodes domain knowledge cheaply: "all products tagged 'linen' have fabric=linen."

006a builds these two primitives. Nothing else. The original 006 plan included eval harness, normalization, review queue, vision tagging, and orchestrator — all deferred. They're polish on a working agent system. Build the agent first.

## 2. Goals & Non-Goals

### Goals
- Hierarchical taxonomy in DB, merchant-editable, with axis definitions per node
- Default taxonomy seeded per storeMode on first install
- Each Product gets a `taxonomyNodeId` via match-keyword scoring
- Rule engine: deterministic if-this-then-that, evaluated on every tagging request
- Rules respect locked axes (HUMAN-edits never overwritten)
- Pre-seeded rules per storeMode for common patterns
- Drawer (005d) reads axes from matched taxonomy node, not just storeMode

### Non-Goals
- No eval harness (deferred to 006b)
- No vision tagging (deferred — paid tier later)
- No normalization pass (deferred to 006b)
- No review queue page (deferred to 006b)
- No orchestrator skeleton (deferred to 006b)
- No tagger response cache (deferred)
- No API spend logging (deferred)
- No drag-and-drop in taxonomy editor (use up/down buttons)
- No taxonomy import/export
- No automatic re-tag of existing products on rule creation (manual button only)

## 3. Schema Changes

```prisma
model TaxonomyNode {
  id            String   @id @default(cuid())
  shopDomain    String
  parentId      String?
  name          String
  slug          String   // shop-unique, e.g. "apparel-tops-shirts"
  position      Int      @default(0)
  axisOverrides Json     // [{ axis, type, values?, order? }] — overrides + additions over inherited
  matchKeywords String[] // strings that boost match score against product title/type/tags
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  parent   TaxonomyNode?  @relation("TaxonomyTree", fields: [parentId], references: [id], onDelete: Cascade)
  children TaxonomyNode[] @relation("TaxonomyTree")

  @@unique([shopDomain, slug])
  @@index([shopDomain, parentId])
}

model TaggingRule {
  id             String   @id @default(cuid())
  shopDomain     String
  name           String
  description    String?
  enabled        Boolean  @default(true)
  priority       Int      @default(100)  // lower = evaluated earlier
  taxonomyNodeId String?               // null = applies regardless of node
  conditions     Json     // see §5.1
  effects        Json     // [{ axis, value }]  — locked is always false; locking is HUMAN-only
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([shopDomain, enabled, priority])
}

// Add to Product:
// taxonomyNodeId  String?
// @@index([shopDomain, taxonomyNodeId])
```

Migration: `add_taxonomy_and_rules`. Both tables nullable-link to existing data, no destructive changes.

## 4. Hierarchical Taxonomy

### 4.1 Default seeds per storeMode

When `ensureMerchantConfig` first sets a real `storeMode`, also call `seedTaxonomy(shopDomain, storeMode)` if the shop has zero TaxonomyNode rows. Cap at 4 levels deep (root → category → subcategory → leaf).

Default trees (in `app/lib/catalog/taxonomy-seeds.ts`):

**fashion**
```
Apparel
├── Tops
│   ├── Shirts
│   ├── T-Shirts
│   ├── Kurtas
│   └── Polos
├── Bottoms
│   ├── Pants
│   ├── Jeans
│   └── Shorts
├── Outerwear
│   ├── Jackets
│   └── Blazers
└── Footwear
Accessories
├── Belts
├── Bags
└── Watches
```

**electronics, furniture, beauty, general** — smaller seed trees; details in `taxonomy-seeds.ts`.

Each leaf gets default `matchKeywords` (e.g. Kurtas: `["kurta", "kurti"]`) and inherits axis definitions from `axis-options.ts` for its storeMode.

### 4.2 Axis inheritance

Effective axes for a node = walk parent → root, merge axisOverrides. Child overrides win on conflict. Additive only (a child can't *remove* a parent axis; it can override the type/values).

Helper: `app/lib/catalog/taxonomy.ts` exports `getEffectiveAxes(nodeId): AxisDefinition[]`.

### 4.3 Product → node matching

For each Product, score every TaxonomyNode in the shop:
- For each `matchKeyword`, score += 1 if it appears in title (case-insensitive), productType, or shopifyTags
- Pick highest-scoring leaf node
- Tie → deepest (most specific) wins
- No matches with score > 0 → use root node

Cache result on `Product.taxonomyNodeId`. Recompute when:
- Product is created or updated via webhook
- Manual "Re-match taxonomy" button on a product (deferred — maintenance task)
- Taxonomy node added/edited (lazy: only re-match products whose current node was deleted)

Helper: `app/lib/catalog/taxonomy-matcher.server.ts` exports `matchProductToNode(product, nodes): string | null`.

### 4.4 Merchant UI — `/app/intelligence/taxonomy`

New page. Layout:
- **Left:** tree view, collapsible, indented. Each row shows name + child count + 3-dot menu.
- **Right:** selected node detail panel — name, slug (read-only), keywords editor, axis overrides editor, parent dropdown, position up/down buttons.
- **Top toolbar:** "Add root node" + "Re-match all products" (button with confirm, runs matcher on all products in background).

Component breakdown:
- `app/routes/app.intelligence.taxonomy.tsx` (page + loader + action)
- `app/components/intelligence/TaxonomyTree.tsx`
- `app/components/intelligence/TaxonomyNodeEditor.tsx`

3-dot per row: Add child / Rename / Delete (with confirm if has children — cascade warning).

### 4.5 API surface

- `GET /api/intelligence/taxonomy` — full tree, JSON
- `POST /api/intelligence/taxonomy` — create node `{ parentId?, name, slug, matchKeywords, axisOverrides, position }`
- `PUT /api/intelligence/taxonomy/:id` — update any field
- `DELETE /api/intelligence/taxonomy/:id` — cascade delete children
- `POST /api/intelligence/taxonomy/rematch-all` — async job, returns jobId; reuses jobs.server.ts pattern from 005a

### 4.6 Acceptance
- [ ] Default tree seeds on first storeMode set per shop
- [ ] Merchant can add/rename/move/delete nodes
- [ ] Axis overrides editor works (single/multi/text + values)
- [ ] Each product gets `taxonomyNodeId` after running re-match
- [ ] Drawer (005d) reads axes from matched node, falls back to storeMode-level axes if `taxonomyNodeId` is null
- [ ] Slug is auto-generated from name + parent path on create

## 5. Rule Engine

### 5.1 Condition shape

```ts
type Condition =
  | { kind: "tag_contains";   value: string; ci?: boolean }
  | { kind: "title_contains"; value: string; ci?: boolean }
  | { kind: "type_equals";    value: string }
  | { kind: "vendor_equals";  value: string }
  | { kind: "price_range";    min?: number; max?: number }
  | { kind: "all"; conditions: Condition[] }   // AND
  | { kind: "any"; conditions: Condition[] }   // OR
  | { kind: "not"; condition: Condition };
```

`ci` defaults to true (case-insensitive).

### 5.2 Effect shape

```ts
type Effect = { axis: string; value: string | string[] };
```

Multi-value axes accept string[]. Single-value accept string.

### 5.3 Evaluation order

For one product:
1. Filter rules: enabled=true, taxonomyNodeId is null OR matches the product's node (or any ancestor)
2. Sort by priority asc (lower first)
3. For each rule: evaluate conditions against product
   - On match: write effects to ProductTag rows
4. **First-match-wins per axis.** If rule A already wrote `colour=blue`, rule B with `colour=red` is ignored for that axis.
5. **Locked axes never overwritten.** If `ProductTag.locked=true` for axis X, skip any rule effect on X.

Rules write `source="RULE"`, `confidence=1.0`, `locked=false` (locking remains HUMAN-only).

### 5.4 Where evaluation happens

Two integration points in this scope:

1. **`POST /api/products/:id/tags/generate`** — currently calls AI directly. Change: run rules first, then AI for any axes still pending after rules.
2. **`POST /api/products/tags/generate-batch`** — same wrapper. Rules run on every product before AI.

Wrapping logic lives in a thin function `applyRules(product, axesNeeded)` in `app/lib/catalog/rule-engine.server.ts`. Returns `{ tagsWritten: TagWrite[], axesStillNeeded: string[] }`. Existing AI tagger receives only `axesStillNeeded` instead of all axes.

This is the *only* AI integration in this spec — and it REDUCES AI calls (rules cover gaps). Net effect: fewer AI tokens consumed, not more.

### 5.5 Pre-seeded rules

In `app/lib/catalog/rule-seeds.ts`, called from `ensureMerchantConfig` when storeMode is set (alongside taxonomy seed). Examples:

**fashion**
- "Linen in tags" → tag_contains "linen" → fabric=linen
- "Men's in title" → title_contains "men's" → gender=male
- "Women's in title" → title_contains "women's" → gender=female
- "Cotton in tags" → tag_contains "cotton" → fabric=cotton
- "Polo type" → title_contains "polo" → category=Polos, sleeve_length=short

Other storeModes get smaller starter sets. Specifics in seed file. Merchants edit/disable freely.

### 5.6 Merchant UI — `/app/intelligence/rules`

New page. Layout:
- **Top:** filter (All / Enabled / Disabled), search by name, "Create rule" button
- **Body:** table of rules — name, conditions summary, effects summary, priority, enabled toggle, actions (edit / test / delete)
- **Modal/drawer for create/edit:** name, description, taxonomy scope dropdown (any node or specific), conditions builder (start with single-condition support; nested all/any can be deferred or use raw JSON for v1 simplicity), effects editor

For v1, **don't ship a visual nested-condition builder.** Single condition per rule (or a flat AND of multiple conditions). Nested `any/not/all` can be authored via raw JSON for power users; we ship a simple builder.

Components:
- `app/routes/app.intelligence.rules.tsx`
- `app/components/intelligence/RuleRow.tsx`
- `app/components/intelligence/RuleEditor.tsx`

### 5.7 Test-against-product

In rule editor: paste a product handle/id → click Test → server runs rule against product (no DB write) → returns "would match: yes/no" + "would write tags: …".

API: `POST /api/intelligence/rules/test` with `{ rule, productId }`. No persistence.

### 5.8 API surface

- `GET /api/intelligence/rules` — list all rules for shop
- `POST /api/intelligence/rules` — create
- `PUT /api/intelligence/rules/:id` — update
- `DELETE /api/intelligence/rules/:id` — delete
- `POST /api/intelligence/rules/test` — test rule against product, no write
- `POST /api/intelligence/rules/apply-all` — run all enabled rules against all products in shop, persist effects (respects locked, respects existing rule-source tags). Async job pattern.

### 5.9 Stat card on dashboard

The "Active rules" card from 005c finally shows a real number = `count(TaggingRule WHERE enabled=true)`. Click navigates to `/app/intelligence/rules`.

### 5.10 Acceptance
- [ ] Pre-seeded rules appear after first install (fashion shop has linen/cotton/men's/women's/polo at minimum)
- [ ] Merchant can create rule with single condition, save, see it in list
- [ ] Test endpoint returns predicted effects without writing
- [ ] Generate (single product) runs rules first, AI fills gaps
- [ ] Apply-all runs against all products in shop, respects locked axes
- [ ] Locked axes never overwritten
- [ ] Stat card "Active rules" shows count, clicks through to rules page
- [ ] First-match-wins on conflicting effects

## 6. Implementation Order

Each step ends green (lint + typecheck + build). Independently committable.

1. **Schema migration** — TaxonomyNode + TaggingRule + Product.taxonomyNodeId. Single migration, named `add_taxonomy_and_rules`.
2. **Seeds infrastructure** — `taxonomy-seeds.ts` + `rule-seeds.ts`. Wire into `ensureMerchantConfig` so first storeMode set triggers seeding.
3. **Helper libs** — `taxonomy.ts` (getEffectiveAxes), `taxonomy-matcher.server.ts`, `rule-engine.server.ts`.
4. **Rules integration into Generate** — modify `api.products.$id.tags.generate.tsx` and batch route to run rules first. Verify locally with a few products.
5. **Taxonomy admin page** — list/edit/seed UI. Build read-only tree first, then add CRUD.
6. **Rules admin page** — list/create/edit/delete + test endpoint.
7. **Drawer integration** — 005d ProductEditDrawer reads from `getEffectiveAxes(taxonomyNodeId)` instead of axis-options directly. Falls back to axis-options when taxonomyNodeId is null.
8. **Stat card link** — Active rules count + click-through.
9. **Re-match-all + apply-all jobs** — both follow 005a's job pattern (in-memory registry, polling). Wire from admin pages.
10. **Smoke test on production** — install, verify seeds appeared, run apply-all, see rule-tagged products in dashboard.

## 7. Migration safety notes

- New tables only nullable-related to existing data. Existing products start with `taxonomyNodeId=null`.
- Drawer falls back to storeMode-level axes when `taxonomyNodeId` is null. No broken UI between migration and re-match.
- Rules table starts empty. Once seeds run on next page load (via ensureMerchantConfig), rules appear.
- Re-match-all is a manual button. Existing tags untouched until merchant clicks it.

## 8. Open Questions

1. **Taxonomy editor — drag-and-drop or up/down buttons?** Recommend up/down buttons for v1. Drag-and-drop adds complexity. Defer.

2. **Rules — visual condition builder or JSON editor for nested logic?** Recommend single-condition builder + JSON textarea for advanced users (`any`/`not`/`all`). v1 keeps it simple.

3. **Rule effect on already-rule-tagged axis.** If a product already has `colour=blue` from rule X, and we run apply-all and rule X still matches, do we overwrite? Recommend: idempotent — same value = no-op, no audit row. Different value = first-match-wins, ignored.

4. **Re-match-all confirm cost.** Re-matching is pure logic, ~10ms per product, no API calls. For 2632 products = ~30s. No confirm dialog needed; just show progress.

5. **Apply-all confirm cost.** Apply-all writes potentially many ProductTag rows. Show confirm: "This will run X rules across Y products. Existing rule-source and AI-source tags may be replaced. Locked tags will not be touched. Continue?"

6. **Should rules pre-fill axisOverrides at the matched taxonomy node level?** No — rules and node axis definitions are orthogonal. Rules write tag VALUES; axes define what KIND of tag is expected. Don't conflate.

7. **What if a product's matched node is deleted?** Recommend: nullify `taxonomyNodeId` on cascade delete. Drawer falls back to storeMode axes. Merchant can run "Re-match all" to assign new nodes.

8. **Stat card click target.** Active rules card → /app/intelligence/rules. Confirmed in §5.9. While we're at it: should "0% tagged" guide also link to /app/intelligence/rules and /app/intelligence/taxonomy as setup actions? Recommend yes — light UX touch, helps merchants discover.

## 9. Out of Scope (deferred to 006b or later)

- Eval harness (006b)
- Normalization pass (006b)
- Review queue (006b)
- Tagger orchestrator skeleton (006b)
- Vision tagging (paid tier later)
- API spend logging (006b)
- Tagger response cache (defer)
- Anthropic Batch API integration (defer)
- Drag-and-drop taxonomy editor (006b polish)
- Visual nested-condition builder (006b polish)
- AI-suggested rules from observed patterns (future)
- Multi-shop taxonomy templates (future)
- Taxonomy import/export (future)

## 10. Files to create

- `app/lib/catalog/taxonomy-seeds.ts` (~150 lines)
- `app/lib/catalog/rule-seeds.ts` (~80 lines)
- `app/lib/catalog/taxonomy.ts` (~80 lines — getEffectiveAxes + slug helpers)
- `app/lib/catalog/taxonomy-matcher.server.ts` (~60 lines)
- `app/lib/catalog/rule-engine.server.ts` (~150 lines)
- `app/routes/app.intelligence.taxonomy.tsx` (~200 lines)
- `app/routes/app.intelligence.rules.tsx` (~200 lines)
- `app/routes/api.intelligence.taxonomy.tsx` (~120 lines)
- `app/routes/api.intelligence.taxonomy.$id.tsx` (~80 lines)
- `app/routes/api.intelligence.taxonomy.rematch-all.tsx` (~60 lines)
- `app/routes/api.intelligence.rules.tsx` (~100 lines)
- `app/routes/api.intelligence.rules.$id.tsx` (~80 lines)
- `app/routes/api.intelligence.rules.test.tsx` (~50 lines)
- `app/routes/api.intelligence.rules.apply-all.tsx` (~60 lines)
- `app/components/intelligence/TaxonomyTree.tsx` (~120 lines)
- `app/components/intelligence/TaxonomyNodeEditor.tsx` (~180 lines)
- `app/components/intelligence/RuleRow.tsx` (~80 lines)
- `app/components/intelligence/RuleEditor.tsx` (~180 lines)

## 11. Files to modify

- `prisma/schema.prisma` — add TaxonomyNode, TaggingRule, Product.taxonomyNodeId
- `app/lib/merchant-config.server.ts` — `ensureMerchantConfig` triggers taxonomy + rules seed when storeMode flips from null to real value
- `app/routes/api.products.$id.tags.generate.tsx` — apply rules before AI
- `app/routes/api.products.tags.generate-batch.tsx` — apply rules before AI
- `app/components/catalog/ProductEditDrawer.tsx` — read axes from getEffectiveAxes(taxonomyNodeId)
- `app/components/catalog/StatsRow.tsx` — wire active rules count + click target

---

*006a is the minimum agent-enablement layer. After it ships, the catalog has structure (taxonomy) and consistency (rules). The stylist agent in 010 can then ask: "give me tops that pair with this kurta" and get a meaningful answer. Without 006a, that question has no good answer.*
