# Feature 006 — Catalog Intelligence Pipeline

**Status:** Draft
**Depends on:** 005a (schema), 005b (AI tagging), 005c (dashboard), 005d (edit drawer)
**Blocks:** 007+ (storefront chat assumes intelligent catalog signals exist)
**Owner:** Midhun

---

## 1. Why

005a–d shipped the merchant cockpit. The merchant can see, edit, and review tags. But the *intelligence* underneath is shallow: text-only AI prompts, flat per-storeMode axis definitions, no measurement of tag quality, no rules layer, no review workflow, no normalization. A real catalog intelligence system has to:

- Generate higher-quality tags using product images, not just titles
- Group products into a hierarchy (Apparel → Tops → Shirts → Linen Shirts) with axis definitions per group
- Apply cheap deterministic rules before reaching for AI (`tag contains "linen" → fabric=linen`)
- Normalize tag values so "Casual" and "casual" don't double-count
- Prioritize a review queue so merchants spend human time where it matters
- Measure quality with an eval harness so we can change models without flying blind

006 builds the engine that turns 005's UI into a real product.

## 2. Goals & Non-Goals

### Goals
- Eval harness with golden fixtures, scoring function, and run history. **Built first** so all subsequent quality changes are measurable.
- Hierarchical taxonomy stored in DB, merchant-editable, with per-node axis definitions overriding parent.
- Rule engine — JSON-defined deterministic rules, evaluated before AI, write tags with `source="RULE"`.
- Vision-based AI tagging — multi-modal Claude call with product images. Hybrid: vision when images exist, text fallback otherwise.
- Normalization pass that case-folds, strips punctuation, and fuzzy-matches against axis vocabulary on every tag write.
- Review queue page with prioritization (low confidence + missing axes first) and keyboard navigation.

### Non-Goals
- No re-implementation of 005a-d. Build on top of existing schema and APIs.
- No automatic re-tagging on schedule. Vision tagging is triggered manually (Tag pending, batch re-tag, single-product Generate). Cron/scheduled re-tagging deferred.
- No multi-shop taxonomy sharing. Each shop has its own tree.
- No taxonomy import/export (JSON download for backup is nice-to-have, deferred).
- No AI-suggested taxonomy auto-generation. Merchant builds tree manually OR seeds from defaults per storeMode.
- No real-time confidence histograms. Aggregate stats only.

## 3. The Seven Capabilities

This spec is structured as 7 sub-features. They build on each other and ship in order.

### 3.1 Eval Harness (built first)
### 3.2 Hierarchical Taxonomy
### 3.3 Rule Engine
### 3.4 Vision-Based Tagging
### 3.5 Normalization Pass
### 3.6 Review Queue
### 3.7 Tagger Orchestration (ties everything together)

Each gets its own §4.x section below.

## 4.1 Eval Harness

### 4.1.1 Why first
Before changing the AI tagger (vision, rules, etc.), we need a way to answer "did that change improve tag quality?" Without this, every change is vibes. The harness exists to lock in measurement before we touch quality.

### 4.1.2 Schema

```prisma
model EvalFixture {
  id          String   @id @default(cuid())
  shopDomain  String
  productId   String   // links to Product, nullable so fixtures can outlive deletions
  goldenTags  Json     // { axis: value | string[] } — the human-curated correct answer
  notes       String?
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([shopDomain, active])
}

model EvalRun {
  id              String   @id @default(cuid())
  shopDomain      String
  taggerVersion  String    // identifier for the tagger config used (e.g., "vision-v1", "text-v1")
  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  fixtureCount    Int
  passCount       Int      // exact-match passes
  partialCount    Int      // partial-match passes (per-axis)
  failCount       Int
  perAxisAccuracy Json     // { axis: 0.85, axis: 0.62 } — fraction correct per axis

  results         EvalResult[]

  @@index([shopDomain, startedAt])
}

model EvalResult {
  id             String   @id @default(cuid())
  evalRunId      String
  fixtureId      String
  productId      String
  predicted      Json     // { axis: value | string[] }
  golden         Json
  perAxisStatus  Json     // { axis: "exact" | "partial" | "miss" | "extra" }
  overallStatus  String   // "pass" | "partial" | "fail"
  durationMs     Int

  evalRun        EvalRun  @relation(fields: [evalRunId], references: [id], onDelete: Cascade)

  @@index([evalRunId])
}
```

### 4.1.3 Fixture creation flow
- Admin page `/app/intelligence/eval` (new). Lists products. Click "Add to fixtures" → captures current tags as golden.
- Bulk-add by filter (e.g., "all human-reviewed products") → adds 50 random as fixtures.
- Manually edit golden values inside the fixture row.
- Toggle active/inactive without deleting (so historical EvalRuns can reference the same fixtureId).

### 4.1.4 Run flow
- Click "Run eval" on the eval page → calls `POST /api/intelligence/eval/run`
- Server picks all active fixtures for shop. For each: load Product, run tagger, compare to golden.
- Per-axis status: `exact` (values identical), `partial` (overlap for multi-value), `miss` (predicted nothing), `extra` (predicted but golden has no expectation), `wrong` (different value).
- Overall status: pass = all exact, partial = any partial without misses, fail = any miss/wrong.
- Persist EvalRun + EvalResult rows.
- UI shows: % pass / partial / fail, per-axis accuracy heatmap, expandable per-product diff.

### 4.1.5 Goal
We don't need 100% pass rate. We need a moving baseline. Run before each major tagger change, run after, compare. If accuracy drops on critical axes (gender, category), revert.

### 4.1.6 Acceptance
- [ ] Can add a product as fixture from the dashboard
- [ ] Can edit golden tags inline
- [ ] Can run eval on all active fixtures
- [ ] EvalRun row persists with overall + per-axis stats
- [ ] Per-product diff renders showing predicted vs golden
- [ ] Two consecutive runs with same tagger produce identical results (deterministic) — IF the model itself is deterministic at temperature=0
- [ ] Run history page shows EvalRun list with sparkline of pass-rate over time

## 4.2 Hierarchical Taxonomy

### 4.2.1 What it is
Replace the flat per-storeMode axis list with a tree of TaxonomyNode rows. Each node has:
- A name (Apparel, Tops, Shirts, Linen Shirts)
- A parent (or null for root)
- A position (within siblings, for ordering)
- Optional axis definitions that override or extend parent axes

When tagging a product, we walk from the product's matched node up to root, inheriting axis definitions. The leaf-most match wins; parent axes are inherited unless overridden.

### 4.2.2 Schema

```prisma
model TaxonomyNode {
  id           String   @id @default(cuid())
  shopDomain   String
  parentId     String?
  name         String
  slug         String   // e.g., "apparel-tops-shirts-linen-shirts"
  position     Int      @default(0)
  axisOverrides Json    // [{ axis, type, values?, order? }] — overrides + additions
  matchKeywords String[]  // strings that, if present in product title/type/tags, suggest this node

  parent       TaxonomyNode?  @relation("TaxonomyTree", fields: [parentId], references: [id], onDelete: Cascade)
  children     TaxonomyNode[] @relation("TaxonomyTree")

  @@unique([shopDomain, slug])
  @@index([shopDomain, parentId])
}
```

Decision: store overrides + additions only, not full axis sets per node. The full effective axis set for a node = walk up to root, merge.

### 4.2.3 Default seeds per storeMode
On first install + storeMode set, seed a default tree:
- **fashion:** Apparel → (Tops, Bottoms, Outerwear, Footwear, Accessories) → leaves
- **electronics:** Devices → (Phones, Laptops, Audio, Wearables) → leaves
- **furniture:** (Living, Bedroom, Office, Outdoor) → leaves
- **beauty:** (Skincare, Makeup, Haircare, Fragrance) → leaves
- **general:** (Catch-all) — single root only

Seed function in `app/lib/catalog/taxonomy-seeds.ts`. Runs from `ensureMerchantConfig` chokepoint when storeMode flips from null to a real value.

### 4.2.4 Merchant UI
New page `/app/intelligence/taxonomy`:
- Tree view (collapsible nodes)
- Add/rename/move/delete nodes
- Per-node axis editor (overrides only — show inherited + own)
- Match keywords editor

Out of scope for v1: drag-and-drop reordering. Use up/down buttons.

### 4.2.5 How products map to nodes
At tag-generation time, the orchestrator picks the best-matching node:
1. For each TaxonomyNode (in shop), score = count of matchKeywords that appear in product title, productType, or shopifyTags.
2. Pick highest-scoring leaf node. Tie → pick the most specific (deepest) one.
3. If no node matches with score > 0, use root (apparel/devices/etc.).

The matched node ID is stored on the product as `taxonomyNodeId`. Cached so we don't re-match every time.

### 4.2.6 Schema addition to Product
```prisma
// add to Product
taxonomyNodeId  String?
@@index([shopDomain, taxonomyNodeId])
```

### 4.2.7 Acceptance
- [ ] Default tree seeds for each storeMode on install
- [ ] Merchant can add/rename/delete nodes
- [ ] Merchant can edit per-node axes
- [ ] Each product gets `taxonomyNodeId` set on next tagging run
- [ ] Drawer shows correct axes for the matched node (not just storeMode-level axes)

## 4.3 Rule Engine

### 4.3.1 What it is
Deterministic if-this-then-that rules evaluated *before* the AI tagger. Cheap, fast, auditable. Good for things AI gets wrong consistently or for things that are explicit in the data ("if shopifyTag includes 'linen', fabric=linen").

### 4.3.2 Schema

```prisma
model TaggingRule {
  id           String   @id @default(cuid())
  shopDomain   String
  name         String
  enabled      Boolean  @default(true)
  priority     Int      @default(100)  // lower = evaluated first
  taxonomyNodeId String?               // null = applies to all nodes; otherwise restricted

  conditions   Json     // see §4.3.3
  effects      Json     // [{ axis, value, locked? }]

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  createdBy    String   // "system" or merchant user id

  @@index([shopDomain, enabled, priority])
}
```

### 4.3.3 Condition shape
```ts
type Condition =
  | { kind: "tag_contains"; value: string; caseInsensitive?: boolean }
  | { kind: "title_contains"; value: string; caseInsensitive?: boolean }
  | { kind: "type_equals"; value: string }
  | { kind: "vendor_equals"; value: string }
  | { kind: "price_range"; min?: number; max?: number }
  | { kind: "all"; conditions: Condition[] }   // AND
  | { kind: "any"; conditions: Condition[] }   // OR
  | { kind: "not"; condition: Condition };
```

Rules evaluate in priority order. First match wins per axis (don't overwrite a rule's value with a later rule's value for the same axis, unless `locked=false` and the later rule has higher priority — but that's complex; v1: first match wins, period).

### 4.3.4 UI
`/app/intelligence/rules`:
- List of rules with toggle (enabled/disabled), priority slider, and inline name/description.
- "Create rule" → form with condition builder (start simple: dropdown for kind + text for value) and effect editor.
- Test against a product: paste product handle/id, see what the rule would set.

### 4.3.5 Pre-seeded rules
Per storeMode, seed a small starter set:
- **fashion:** "linen in tags → fabric=linen", "men's in title → gender=male", "women's → gender=female", "polo → category=polo, sleeve=short" etc.
- **electronics, furniture, etc.:** smaller starter sets.

### 4.3.6 Source attribution
Rules write `ProductTag.source = "RULE"` and `confidence = 1.0` (deterministic). They respect locked-axis: if an axis is already locked (HUMAN), don't overwrite.

### 4.3.7 Acceptance
- [ ] Merchant can create/edit/disable rules
- [ ] Rules evaluate in priority order
- [ ] Locked axes never overwritten by rules
- [ ] Rules write source=RULE, confidence=1.0
- [ ] Stat card "Active rules" finally shows non-zero count (currently always 0 — see 005c)

## 4.4 Vision-Based Tagging

### 4.4.1 What changes
Replace the text-only Claude call in `ai-tagger.server.ts` with a multi-modal call when product images exist. Images are passed as base64 or URL (Claude SDK supports both).

Hybrid flow:
- If product.featuredImageUrl exists → vision call (text + image)
- If no image → existing text-only call
- Both paths go through orchestrator (§4.7), so callers don't care which was used.

### 4.4.2 Image preparation
- Use `featuredImageUrl` + up to 2 alternate images from `imageUrls`
- Resize/compress isn't worth it — Claude handles full-size images well, and downsizing adds latency
- Pass images as `{ type: "image", source: { type: "url", url: ... } }`

### 4.4.3 Cost & rate limits
Vision calls cost ~10x text. For a 2632-product re-tag, expect $5-15 spend. Bounded.

Concurrency: vision calls are slower (~3-5s per call vs <1s text). Drop p-limit from 5 to 3 for vision batch jobs. Update `api.products.tags.generate-batch.tsx` accordingly.

### 4.4.4 Prompt change
Current prompt: "Here's a product, return tags for these axes."
New prompt: "Here's a product (image + title + description). Look at the image. Return tags for these axes."

Add: "If you can see the colour clearly in the image, prefer that over text-described colour."

### 4.4.5 Acceptance
- [ ] Product with image → tagged using vision call (verify in eval harness — colour accuracy should jump)
- [ ] Product without image → tagged using text-only fallback
- [ ] Batch tagging respects new concurrency limit
- [ ] Eval harness shows accuracy delta vision vs text on same fixture set

## 4.5 Normalization Pass

### 4.5.1 What it is
Every tag write goes through a normalization function. "Casual" → "casual". "100% Linen" → "linen". "Sky Blue" stays "sky blue" (multi-word values preserved).

### 4.5.2 Where it lives
New file: `app/lib/catalog/normalize.ts`. One function:
```ts
function normalizeTagValue(axis: string, rawValue: string, axisOptions: AxisDefinition): string
```

Steps:
1. Trim whitespace
2. Lowercase
3. Strip punctuation (commas, parens, %)
4. If `axis.type === "single" | "multi"` and value list is known (from axis-options.ts and taxonomy overrides), fuzzy-match against allowed values. Closest match (Levenshtein distance ≤ 2) wins. If no close match, store as-is (so we don't silently drop a valid new value).
5. If `axis.type === "text"`, just trim + lowercase.

### 4.5.3 Where to apply
- `ai-tagger.server.ts` — before writing AI-generated tags
- Rule engine — before writing rule effects (rules should already use canonical values, but defensive)
- `api.products.$id.tags.tsx` — on PUT replace_all / replace_axis / merge — normalize all incoming values
- `api.products.$id.tags.generate.tsx` — already covered by tagger

Drawer doesn't pre-normalize what the user types (UX would be jarring) — the API layer normalizes on save.

### 4.5.4 Backfill
Optional: one-shot job to normalize all existing tags. New endpoint `POST /api/intelligence/normalize-existing` with confirm. Iterate ProductTag rows in batches, normalize value, update if changed, write audit row.

### 4.5.5 Acceptance
- [ ] All new tag writes go through normalization
- [ ] "Casual" and "casual" never coexist as separate tags after this ships
- [ ] Backfill endpoint exists and can be run manually
- [ ] Audit row written for each normalized change in backfill

## 4.6 Review Queue

### 4.6.1 What it is
A paginated, prioritized workflow page. Products needing review surface here in priority order. One-product-at-a-time UI with keyboard nav.

### 4.6.2 Prioritization
Score each product, surface lowest scores (worst first):
- -50 if any pending axis (incomplete tagging)
- -10 per AI-source axis with confidence < 0.7
- -5 per AI-source axis with confidence < 0.85
- 0 baseline
- +100 if all axes are HUMAN-reviewed

This is just a first heuristic. Tweak after real merchant feedback.

### 4.6.3 Schema
No new tables. Compute priority on the fly from existing ProductTag rows.

Optionally: add `reviewedAt` timestamp on Product so we can deprioritize recently-reviewed products from re-surfacing.
```prisma
// add to Product
reviewedAt DateTime?
```

### 4.6.4 UI
New page `/app/intelligence/review`:
- Single product card large in center (image, title, all axes editable)
- Side: list of next 5 in queue (collapsed)
- Keyboard: J/K = next/prev product, A = approve (mark reviewed), E = focus first axis, Enter = save
- Header: "12 of 1247 products in queue"

Approving = same as Mark Human Reviewed (source=HUMAN, locked=true on all tags).

### 4.6.5 Wire to dashboard
The disabled "Open review queue" CTA in WorkflowBar (from 005c) finally enables and routes to `/app/intelligence/review`.

### 4.6.6 Acceptance
- [ ] Queue surfaces lowest-priority product first
- [ ] J/K navigates between products
- [ ] A approves and advances
- [ ] E jumps to first axis input
- [ ] Approving a product writes source=HUMAN, locked=true on all axes
- [ ] Dashboard CTA enables and routes correctly
- [ ] Queue size shown in header updates as products are reviewed

## 4.7 Tagger Orchestration

### 4.7.1 What it is
A single function `tagProduct(productId, options)` that runs the full pipeline:
1. Load product + matched taxonomy node + active rules
2. Apply rules → write source=RULE tags (skipping locked axes)
3. For axes still pending, call vision/text AI → write source=AI tags
4. Apply normalization on all writes

Replaces direct calls to `ai-tagger.server.ts` from API routes. The API routes call the orchestrator instead.

### 4.7.2 New file
`app/lib/catalog/orchestrator.server.ts`. Exports `tagProduct(productId, opts)`.

### 4.7.3 Options
```ts
type TagOptions = {
  forceVision?: boolean;        // ignore "no image" fallback
  skipRules?: boolean;          // diagnose AI in isolation
  skipAI?: boolean;             // rules-only mode
  evalMode?: boolean;           // don't write to DB, return predictions
  taggerVersion?: string;       // for eval harness — pins config
};
```

### 4.7.4 Affected callers
- `api.products.$id.tags.generate.tsx` → uses orchestrator
- `api.products.tags.generate-batch.tsx` → uses orchestrator
- Eval harness `POST /api/intelligence/eval/run` → uses orchestrator with `evalMode=true`

### 4.7.5 Acceptance
- [ ] Single-product Generate uses orchestrator
- [ ] Batch Generate uses orchestrator
- [ ] Eval harness uses orchestrator in evalMode
- [ ] Locked axes never overwritten regardless of source
- [ ] Rules apply before AI, AI fills gaps

## 5. Implementation Order

Build in this exact order. Each step ends green (lint + typecheck + build) and is independently committable.

### Phase A: Foundation (Day 1 morning)
1. Schema migrations: EvalFixture, EvalRun, EvalResult, TaxonomyNode, TaggingRule + Product additions (taxonomyNodeId, reviewedAt)
2. `app/lib/catalog/taxonomy-seeds.ts` with default trees per storeMode
3. `ensureMerchantConfig` — extend to also seed taxonomy when storeMode is set
4. `app/lib/catalog/normalize.ts`

### Phase B: Eval harness (Day 1 afternoon)
5. `/app/intelligence/eval` page (list fixtures, add/edit, run button)
6. `POST /api/intelligence/eval/run` (initially calls existing tagger as-is, just to prove harness works)
7. Add 30-50 fixtures from existing human-reviewed products (or from one we manually tag) — needed before next steps to measure impact
8. Run baseline eval. Record baseline accuracy. **This is the number we beat.**

### Phase C: Orchestrator + Rules (Day 2 morning)
9. `orchestrator.server.ts` with current tagger as the AI step
10. Refactor api.products.$id.tags.generate + batch to use orchestrator
11. Re-run eval — should match baseline (regression check)
12. Rule engine: schema is in, build evaluation logic
13. `/app/intelligence/rules` page
14. Pre-seed rules per storeMode
15. Run eval — accuracy should improve (rules cover obvious cases)

### Phase D: Taxonomy (Day 2 afternoon)
16. Per-product taxonomyNodeId computation (matchKeywords → product matching)
17. `/app/intelligence/taxonomy` page (tree view, edit/add/delete)
18. Drawer in 005d reads taxonomy node axes (not just storeMode axes)
19. Eval should still pass (no regression)

### Phase E: Vision tagging (Day 3 morning)
20. Update ai-tagger to accept image input
21. Hybrid logic in orchestrator: vision when image, text otherwise
22. Reduce batch concurrency to 3
23. Run eval — vision should beat text on colour, fit, style

### Phase F: Normalization + Review queue (Day 3 afternoon)
24. Apply normalize on all write paths
25. Backfill endpoint (optional run, defer if time)
26. `/app/intelligence/review` page with keyboard nav
27. Wire dashboard CTA to enable

### Phase G: Polish + ship (Day 4 if needed)
28. Smoke test entire pipeline end-to-end
29. Run final eval, document accuracy delta
30. Fix any bugs found

## 6. New API Surface (summary)

- `POST /api/intelligence/eval/fixtures` — add fixture
- `PUT /api/intelligence/eval/fixtures/:id` — edit golden
- `DELETE /api/intelligence/eval/fixtures/:id` — soft delete (toggle active)
- `POST /api/intelligence/eval/run` — run eval, return EvalRun id
- `GET /api/intelligence/eval/runs` — list past runs
- `GET /api/intelligence/eval/runs/:id` — run detail with per-product diffs
- `GET /api/intelligence/taxonomy` — full tree
- `POST /api/intelligence/taxonomy` — create node
- `PUT /api/intelligence/taxonomy/:id` — update node (name, axes, keywords, position, parent)
- `DELETE /api/intelligence/taxonomy/:id` — delete (cascade children)
- `GET /api/intelligence/rules` — list rules
- `POST /api/intelligence/rules` — create
- `PUT /api/intelligence/rules/:id` — update
- `DELETE /api/intelligence/rules/:id` — delete
- `POST /api/intelligence/rules/:id/test` — run rule against a product, return predicted effect (no write)
- `GET /api/intelligence/review/queue` — paginated review queue
- `POST /api/intelligence/normalize-existing` — backfill normalization

## 7. Component Changes (summary)

### New pages
- `app/routes/app.intelligence.eval.tsx` — eval harness UI
- `app/routes/app.intelligence.taxonomy.tsx` — taxonomy editor
- `app/routes/app.intelligence.rules.tsx` — rules editor
- `app/routes/app.intelligence.review.tsx` — review queue

### New components
- `app/components/intelligence/EvalRunCard.tsx`
- `app/components/intelligence/FixtureRow.tsx`
- `app/components/intelligence/TaxonomyTree.tsx`
- `app/components/intelligence/TaxonomyNodeEditor.tsx`
- `app/components/intelligence/RuleRow.tsx`
- `app/components/intelligence/RuleEditor.tsx`
- `app/components/intelligence/ReviewCard.tsx` (single-product big card with keyboard nav)
- `app/components/intelligence/ReviewQueueSidebar.tsx`

### New libs
- `app/lib/catalog/taxonomy-seeds.ts`
- `app/lib/catalog/normalize.ts`
- `app/lib/catalog/rule-engine.server.ts`
- `app/lib/catalog/orchestrator.server.ts`
- `app/lib/catalog/eval-harness.server.ts`
- `app/lib/catalog/taxonomy-matcher.server.ts`

### Modified
- `app/lib/catalog/ai-tagger.server.ts` — accept images, vision prompt
- `app/routes/app.products.intelligence.tsx` — drawer reads taxonomy node axes; CTAs to new pages
- `app/components/catalog/Dashboard.tsx` — wire "Open review queue" + "Apply rules" CTAs
- `app/components/catalog/ProductEditDrawer.tsx` — read axes from taxonomy node, not just storeMode
- `app/components/catalog/StatsRow.tsx` — "Active rules" shows real count
- `app/lib/merchant-config.server.ts` (`ensureMerchantConfig`) — seed taxonomy + rules on first storeMode set

## 8. Open Questions

1. **Taxonomy depth limit.** Cap at 4 levels (root → category → subcategory → leaf)? Or unlimited? Recommend cap at 4 — deeper trees are usually a sign of bad design and the matchKeywords scoring breaks down with too many siblings.

2. **Rule conflict resolution beyond "first match wins."** What if rule A says `colour=blue` and rule B says `colour=red` for the same product? Recommend first-match-wins for v1. Surface a warning in the UI when two rules match same axis.

3. **Eval fixture creation source of truth.** When merchant adds a fixture, do we snapshot tags as they are RIGHT NOW (and they can edit), or require manual entry? Recommend snapshot + edit. Fewer keystrokes.

4. **Vision prompt — single call or per-axis call?** Single call returns all axes in one shot. Per-axis is more accurate but 10x slower and 10x more expensive. Recommend single call.

5. **Vision images — featuredImageUrl only, or all imageUrls?** Recommend featuredImageUrl + up to 2 alternate (cap on cost). Alternate images especially useful for back-of-product shots that show fabric/details.

6. **Review queue: what counts as "completed"?** Approving advances. Cancelling skips (still marked as seen but not reviewed). Recommend: "skip" is a valid action that adds 24h cooldown before product re-surfaces.

7. **Taxonomy axis inheritance — additive only, or can a child node REMOVE a parent axis?** Recommend additive + override only. Removal too complex for v1.

8. **Rules — apply on every product or only newly-pending?** Recommend: rules apply on every Generate-tags call. Re-running rules against existing AI-tagged products is a manual action (not automatic) to avoid surprise overwrites. UI button: "Apply rules to all products" with confirm.

9. **Normalization aggressiveness.** Levenshtein ≤ 2 might match "linen" and "linon" (typo) — good. But also "casual" and "casuel" (correct in some languages) — bad? Recommend distance ≤ 1 for safety, expand if false-negatives surface.

10. **Eval harness: include image-based products in fixtures or text-only?** Recommend mix. Text-only fixtures show text-tagger baseline; image fixtures show vision-tagger baseline. Compare apples-to-apples.

11. **Review queue throttle.** If merchant has 2632 products and 1247 need review, that's a wall. Should the queue cap at 100 surfaced and refresh after? Recommend: no cap, but show clear "1247 to go" header so merchant knows scale.

12. **Should `Active rules` stat card on dashboard navigate to `/app/intelligence/rules` on click?** Recommend yes. Stat cards being click-through is a free UX win.

## 9. Risk Areas

- **Cost.** Vision tagging on 2632 products = real money. Add a confirm dialog with cost estimate before batch-vision-retag is allowed. Estimate = N products × $0.01 (rough).
- **Eval fixture maintenance.** Fixtures rot — golden tags become stale as catalog evolves. v1 doesn't address this. Future: re-validate fixtures quarterly.
- **Taxonomy match accuracy.** matchKeywords scoring is naive. A product titled "Men's Polo Shirt" could match "Men's", "Polo", "Shirt" nodes simultaneously. Tie-breaking rule (deepest wins) helps but isn't bulletproof. Acceptable for v1; revisit if matcher accuracy < 80% on eval.
- **Rules engine perf.** N products × M rules × C conditions per rule = potential O(NMC) on every batch tag. With 2632 products and ~50 rules and ~3 conditions/rule = ~400k condition evals per batch. Should be fast (string ops), but watch.
- **Migration size.** This adds 5 new tables + 2 new Product columns. Migration is non-trivial but reversible. Test on Railway with a `prisma migrate deploy --dry-run` equivalent if possible (Prisma doesn't have one — careful local test instead).

## 10. Out of Scope

- Cron-scheduled re-tagging
- AI-suggested taxonomy auto-generation
- Cross-shop taxonomy sharing
- Taxonomy import/export
- Confidence histogram dashboards
- Multi-language tag values (English only)
- Re-validating fixtures over time
- Drag-and-drop in taxonomy editor (use up/down buttons)
- Backfill of taxonomy match for products synced before this feature (run manually post-deploy)
- AI-suggested rules from observed catalog patterns
- Approve-without-edit shortcut in review queue (defer to v2)

## 11. Dependencies

- 005a-d schema must be in place
- `ensureMerchantConfig` chokepoint from Layer 2 must exist
- `axis-options.ts` from 005d is the seed for default taxonomy axes
- `ai-tagger.server.ts` from 005b is the AI step (will be wrapped by orchestrator)

## 12. Migration safety notes

This adds 5 tables + 2 Product columns. Existing products won't have `taxonomyNodeId` set until a backfill runs. Plan:
1. Migration adds nullable `taxonomyNodeId`
2. Post-migration: a one-shot job runs taxonomy matching against all existing products and sets the column
3. Drawer falls back to storeMode-level axes if `taxonomyNodeId` is null

This means there's no "broken state" between migration and backfill — the system gracefully degrades.

---

*006 transforms the AI tagger from "make a Claude call per product" into a real catalog intelligence system: measured, deterministic-where-possible, hierarchical, vision-capable, normalized, and human-reviewable. After this, the merchant has a tool that learns and improves over time, not just a one-shot AI labeler.*
