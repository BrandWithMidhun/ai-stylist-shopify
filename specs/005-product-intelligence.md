# Feature 005: Product Intelligence Engine (first pass)

## Purpose

Generate AI-powered tags for products in the merchant's store. This is the first user-visible AI feature: merchants paste/install the app, view their products, click a button, and see Claude analyze each product and suggest structured tags.

This is first-pass scope — tags are displayed in the admin UI only, not written back to Shopify metafields. Writeback happens in Feature 005.1.

## User-visible outcome

A new admin page at /app/products/intelligence with:
- A list of the store's products (title, image, current Shopify tags)
- A "Generate tags" button next to each product
- A "Generate tags for all" button at the top
- When tags are generated, they display inline below each product, grouped by dimension (category, style, occasion, color, material)
- Loading state per-product while generation runs
- Error state per-product if a single generation fails (other products continue)

## Scope

### In scope

- Fetch up to 50 products from Shopify Admin API via GraphQL (first page only — no pagination yet)
- For each product, call callClaude with a structured prompt asking for tags in JSON format
- Parse Claude's JSON response safely with zod validation
- Display generated tags grouped by dimension
- Per-product Generate button + "Generate for all" batch button
- Batch processing uses Promise.allSettled so one failed product doesn't kill the batch
- Tags stored in memory only (component state) — lost on page refresh
- Store mode from MerchantConfig influences the prompt (fashion vs generic)

### Explicitly out of scope

- Writing tags back to Shopify metafields (Feature 005.1)
- Persisting generated tags to our Postgres (no model yet)
- Pagination beyond first 50 products
- Bulk operations with progress bar (we accept the "all N products spinning" UX for first pass)
- Tag editing or approval workflow
- Merchant-configurable tag dimensions
- Tag caching / dedup (re-running on same product re-calls Claude)
- Rate limiting (we rely on Anthropic tier limits; if we hit them, individual products fail gracefully)

## Architecture

### File layout

- app/lib/product-intelligence.server.ts: exports generateTagsForProduct(product, storeMode): Promise<TagResult> which builds the prompt and calls callClaude. Handles JSON parsing + zod validation. Returns typed result: { ok: true, tags } or { ok: false, error }.
- app/lib/shopify-products.server.ts: exports fetchProducts(admin, limit): Promise<Product[]> which runs a GraphQL Admin API query to fetch product title, id, handle, featured image, tags.
- app/routes/app.products.intelligence.tsx: route with loader (fetches products + merchant config) and action (handles Generate button for a specific product or all products).

### Tag schema

type Tags = {
  category: string;        // e.g., "Dress", "Shoes", "Laptop"
  style: string[];          // e.g., ["casual", "summer"]
  occasion: string[];       // e.g., ["beach", "party"]
  color: string[];          // extracted from product data
  material: string[];       // e.g., ["cotton", "leather"]
};

Zod schema enforces this exactly; any extra keys or missing keys cause { ok: false, error }.

### Prompt strategy

Single-shot user message with clear structure request:
1. Short system-style context in the user message: "You are a product tagging assistant for a [Fashion|General] Shopify store."
2. Product details (title, description, current tags)
3. Request JSON output matching the schema
4. Use Claude response prefill (pre-filling { in the assistant turn) to guarantee valid JSON start

Model: claude-sonnet-4-5 (via callClaude default), temperature 0.3 (lower for structured output).

### Store mode handling

Loader reads MerchantConfig.storeMode for the authenticated shop. Passed to generateTagsForProduct which adjusts the prompt context: Fashion mode asks for style/occasion/material more assertively; General mode focuses on category/color/usage.

### Shopify GraphQL query

A simple query on products (first: 50):
- id, handle, title, description (first 500 chars), featuredImage.url, tags.

Uses the template's existing authenticate.admin and admin.graphql.

### UI behavior

- Products render as a list (stack of rows), each with: thumbnail, title, current-tags chips, Generate button, tag output area
- Generate button per product: triggers fetcher submission to the action with productId
- "Generate for all" button: iterates products client-side, triggering one action per product in parallel
- Loading state: skeleton or spinner while waiting
- Results: tags grouped by dimension with section headers
- Error: small red banner inline next to the product

## Success criteria

1. Click Generate on one product → see structured tags appear in under 10 seconds
2. Click Generate for all → see all products process (some may fail, that's OK; failed ones show error)
3. Tags are structured: they render grouped by category/style/occasion/color/material
4. Page doesn't crash when Claude returns malformed JSON — shows a per-product error
5. Page doesn't crash when product has no description or missing image — still generates tags
6. Works on Railway production

## Non-goals

- Beautiful UI. Functional Polaris is fine.
- Prompt quality beyond "reasonable for demo purposes." We'll tune prompts in Feature 005.2 when we see what real merchants think.
- Deduplication or caching. Every click re-runs.

## Dependencies

- zod (already in Shopify template? verify in package.json; install as runtime if missing)
- @anthropic-ai/sdk (already installed in Feature 004)
- No new env vars
- No new Prisma migrations

## Testing

Needs at least 3 products in your dev store. If you don't have products, use the "Generate a product" button on the Starter demo page first to create a few.

Success path:
1. Navigate to /app/products/intelligence
2. See list of products
3. Click Generate on first product
4. Tags appear grouped by dimension in under 10 seconds
5. Click Generate for all — all products process in parallel
6. Some products succeed, maybe one fails (okay)

Error path:
- Use a product with an empty description + no image — generation should still work (Claude infers from title alone)
- If Anthropic rate-limits, one or more products show rate-limit error — others continue
