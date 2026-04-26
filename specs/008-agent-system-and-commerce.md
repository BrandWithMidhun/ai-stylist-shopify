# Feature 008 — Agent System + Commerce Capability

**Status:** Draft
**Depends on:** 005a-d (product sync + tagging), 006a (taxonomy + rules), 007 (chat widget shell)
**Blocks:** 010 (stylist agent), 011 (quiz engine), 012 (cart actions), 014 (lookbook)
**Owner:** Midhun
**Estimated effort:** 2-3 days (Phase 1 tonight, Phase 2-3 tomorrow)

---

## 1. Why

007 shipped a beautiful widget that returns hardcoded text. 008 makes it actually intelligent — real Claude responses to real user queries with real product results.

This is the moment your project transitions from "AI commerce shell" to "AI commerce product." The widget code from 007 stops changing; only the backend gets smarter.

Combined scope (originally 008 + 009): orchestrator pattern + first capability (commerce). This vertical slice proves the architecture works end-to-end. Adding stylist (010), lookbook (014), cart actions (012) is then a repeatable pattern.

## 2. Goals & Non-Goals

### Goals
- Replace canned-response logic with real Claude integration via tool calling
- One capability shipped: **product search** (universal across all storeModes)
- Rich product cards in chat: image, title, price, taxonomy badge, View + Add-to-Cart buttons
- Buyer can search by intent: "show me linen kurtas under ₹3000", "what's trending", "I need a gift"
- Conversation memory: Claude sees last 10 messages including past tool results
- Mode-aware tool descriptions (stylist tool exists conceptually but isn't wired in 008 — placeholder for 010)
- Cost guardrails: hard token limit per request, request rate limit per session
- Storefront Add-to-Cart wires into Shopify's `/cart/add.js` (no checkout yet — that's 012)

### Non-Goals (deferred)
- Stylist capability — 010 (gated to FASHION/JEWELLERY)
- Lookbook capability — 014
- Quiz / customer onboarding — 011
- Real checkout flow — 012/013 (Add-to-Cart works; checkout uses Shopify's standard flow)
- Persistent chat history across sessions — defer (memory is per-session-cookie only)
- Customer account linking — defer to 011
- Multi-language responses — defer
- Analytics events for chat interactions — 015
- Image upload by user — defer
- Voice input — defer
- Streaming responses — see §11 risk
- Prompt caching — defer optimization
- Multi-turn tool chaining beyond what Sonnet does naturally — defer
- Rich messages beyond product cards (carousels, galleries, image responses) — defer to 010+
- Server-side stock/price refresh per request — defer to 012 (Postgres data is "good enough" for v1)

## 3. Architecture

### 3.1 The flow

```
User types message in widget
    ↓
POST /api/chat/message  (007's endpoint, now upgraded)
    ↓
Load: session UUID, last 10 messages, merchant config (storeMode), tool definitions
    ↓
Build Claude request:
  - System prompt (mode-aware)
  - Conversation history (last 10 messages)
  - User message
  - Tool definitions (search_products available always; future: search_outfits, browse_lookbook)
    ↓
Call Sonnet 4.5 with tools
    ↓
Branch on response:
  
  A. Claude returns text only → return to widget
  
  B. Claude calls tool(s):
       1. Execute tool locally (Postgres query)
       2. Format tool result as structured JSON
       3. Send tool result back to Claude in same conversation
       4. Claude synthesizes final response with product references
       5. Return final response to widget (text + structured products)
    ↓
Widget renders:
  - Assistant message bubble (text)
  - Below: rich product cards (if products in response)
  - Suggestion chips (always)
```

### 3.2 The chat backend layer split

```
app/routes/api.chat.message.tsx          ← entry point (already exists from 007)
app/lib/chat/
  agent.server.ts                        ← orchestrator: builds Claude request, handles tool calls
  tools/
    search-products.server.ts            ← tool implementation (Postgres query)
    types.ts                             ← shared tool result types
  prompts.server.ts                      ← system prompt builder (mode-aware)
  cost-guards.server.ts                  ← token + rate limits
  conversation.server.ts                 ← history fetching, context window management
```

### 3.3 Conversation state model

Anonymous sessions: `aistylist_session_id` cookie (set in 007).

For 008, we need to remember last 10 messages so Claude has context. Options:

**Option A — Postgres-backed history table.** New `ChatSession` + `ChatMessage` tables. Persistent across page reloads.

**Option B — In-memory cache (Redis or process-local).** Faster, doesn't survive restart, lossy.

**Option C — Client-sent history.** Widget sends last N messages with each request. Server is stateless. Privacy-friendly.

**Decision: Option C for v1.** Widget already maintains state internally. Sending last 10 messages with each request means:
- No new schema
- Server stateless — easy to scale
- Conversation persists naturally with widget state (in-memory in browser)
- Cost: ~2x bandwidth per request, negligible

Trade-off: if user reloads the page, conversation memory is lost. Acceptable for v1 (chat sessions are usually short-lived). v2 can add Postgres persistence by adding a session-scoped storage layer without changing this contract.

### 3.4 Tool calling pattern

Standard Anthropic Messages API tool calling. The agent builds this request:

```ts
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  system: systemPrompt,
  tools: [searchProductsTool],
  messages: [
    ...history,
    { role: "user", content: userMessage }
  ]
});
```

Two response paths:

**stop_reason = "end_turn":** Claude responded with text only. Return to widget.

**stop_reason = "tool_use":** Claude wants to call a tool. We:
1. Find the `tool_use` block, get tool name + input
2. Execute the tool (e.g., `searchProducts({ query: "kurta", price_max: 3000 })`)
3. Append both `assistant` (with tool_use) and `user` (with tool_result) messages to history
4. Make a second API call with this updated history
5. Claude returns final text response synthesizing the products
6. Return final response + structured product data to widget

Multi-turn tool calls happen if Claude wants to call multiple tools (e.g., search then refine). Loop the above for up to N=3 iterations. Most queries resolve in 1-2 tool calls.

### 3.5 Why Postgres for product search (not Storefront API)

We already have:
- 2632 products synced via 005a
- Rich tags via 006a (rules + AI): category, color, size, material, occasion, style, price_tier, etc.
- Per-product taxonomy node assignments

A Postgres query with full-text + tag filters returns relevant products in <50ms. Storefront API would add:
- 200-500ms network latency per query
- Rate limits (eventually)
- Complexity (separate auth flow)

For v1, Postgres is faster, cheaper, and more flexible. We accept that stock/price might be slightly stale — the widget shows the cached values, and Add-to-Cart hits Shopify's storefront `/cart/add.js` which validates stock at that moment.

### 3.6 Mode-aware system prompts

The system prompt changes based on `storeMode`:

**FASHION:** "You are a shopping assistant for [Shop Name], a fashion store. Help customers find clothing, accessories, and jewellery..."

**JEWELLERY:** "You are a shopping assistant for [Shop Name], a jewellery store. Help customers find rings, necklaces, earrings... For Indian jewellery questions about purity, gemstones, bridal collections..."

**ELECTRONICS, FURNITURE, BEAUTY, GENERAL:** Equivalent versions.

The mode-aware prompt:
- Sets context for what kinds of questions are normal
- Adapts tone slightly (jewellery merchants are more formal; fashion is conversational)
- Hints at common queries to guide tool usage

Same `search_products` tool everywhere — only the system prompt and tool *description* change per mode. This means adding stylist (010) tool later is just "include this tool when storeMode=FASHION/JEWELLERY in agent.server.ts".

## 4. The Six Sub-Features

### 4.1 The orchestrator (agent.server.ts)
### 4.2 The search_products tool
### 4.3 Rich product card rendering in widget
### 4.4 Add-to-Cart wiring on storefront
### 4.5 Cost guards
### 4.6 Mode-aware system prompts

Each gets its own §5.x.

## 5.1 The Orchestrator (agent.server.ts)

### 5.1.1 Public interface

```ts
export type AgentInput = {
  shopDomain: string;
  sessionId: string;
  text: string;
  context?: ProductContext;  // from 007 product CTA
  history: WidgetMessage[];  // last 10 from widget state
};

export type AgentOutput = {
  message: {
    id: string;
    role: 'assistant';
    content: string;
    timestamp: number;
    products?: ProductCard[];  // structured data for rich rendering
    suggestions?: string[];    // chips
  };
  debug?: {
    toolCalls: number;
    tokensUsed: number;
    durationMs: number;
  };
};

export async function runAgent(input: AgentInput): Promise<AgentOutput>;
```

### 5.1.2 Internal flow

```ts
async function runAgent(input) {
  // 1. Validate cost guards
  await assertWithinLimits(input.shopDomain, input.sessionId);

  // 2. Load merchant config (for storeMode)
  const config = await loadMerchantConfig(input.shopDomain);

  // 3. Build system prompt
  const system = buildSystemPrompt(config);

  // 4. Build tool list (only commerce in 008; expanded in 010+)
  const tools = buildToolList(config);

  // 5. Build messages with history + context
  const messages = buildMessages(input);

  // 6. Loop: Claude → tool? → execute → Claude → ...
  let response = await callClaude({ system, tools, messages });
  let toolCallCount = 0;
  const collectedProducts: Product[] = [];

  while (response.stop_reason === 'tool_use' && toolCallCount < MAX_TOOL_CALLS) {
    const toolBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResults = await Promise.all(
      toolBlocks.map(async (block) => {
        const result = await executeTool(block.name, block.input, input.shopDomain);
        if (result.products) collectedProducts.push(...result.products);
        return { tool_use_id: block.id, content: JSON.stringify(result) };
      })
    );

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: toolResults.map(r => ({ type: 'tool_result', ...r }))
    });

    toolCallCount++;
    response = await callClaude({ system, tools, messages });
  }

  // 7. Extract final text
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

  // 8. Format response for widget
  return {
    message: {
      id: generateId(),
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
      products: dedupeAndShape(collectedProducts),
      suggestions: extractSuggestions(text, config),
    },
    debug: { toolCallCount, tokensUsed, durationMs }
  };
}
```

### 5.1.3 Important: artificial 600ms minimum delay stays

We keep 007's 600ms artificial floor. Real Claude responses with tool calls take 800-2500ms typically, well above the floor. But for trivial queries that Claude answers quickly without tools, the floor preserves the typing-indicator UX from 007.

### 5.1.4 Acceptance
- [ ] Returns structured `AgentOutput` for any input
- [ ] Handles tool calls (1+) correctly
- [ ] Loops up to MAX_TOOL_CALLS (default 3) then stops gracefully
- [ ] Rejects requests that exceed cost guards
- [ ] Handles Claude API errors gracefully (returns fallback message)
- [ ] Logs duration + token usage for observability

## 5.2 The search_products tool

### 5.2.1 Tool definition for Claude

```ts
export const searchProductsTool = {
  name: "search_products",
  description: "Search the merchant's product catalog. Use this when the user is looking for specific products, asking about inventory, browsing, or wanting recommendations. The merchant's storeMode tells you what kind of products they sell. Be specific in queries — use product attributes (color, material, occasion, price range) extracted from the user's intent.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Free-text search keywords (e.g. 'linen kurta', 'wireless headphones', 'diamond ring'). Maps to product title, description, type."
      },
      price_min: { type: "number", description: "Minimum price (optional)" },
      price_max: { type: "number", description: "Maximum price (optional)" },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Filter by specific tags. Examples by storeMode: FASHION → ['cotton', 'casual', 'men'], ELECTRONICS → ['wireless', 'gaming'], BEAUTY → ['vegan', 'oily-skin']. Multi-value AND logic."
      },
      taxonomy: {
        type: "string",
        description: "Filter by taxonomy node slug (e.g. 'tops/kurtas'). Use when user is browsing a category."
      },
      limit: {
        type: "number",
        description: "Max products to return (default 6, max 12)",
        default: 6
      }
    },
    required: ["query"]
  }
};
```

### 5.2.2 Tool implementation (search-products.server.ts)

```ts
export async function searchProducts(
  input: SearchProductsInput,
  shopDomain: string
): Promise<SearchProductsResult> {
  const where = {
    shopDomain,
    status: 'ACTIVE',  // skip drafts/archived
  };

  // Free-text on title/description
  if (input.query) {
    where.OR = [
      { title: { contains: input.query, mode: 'insensitive' } },
      { description: { contains: input.query, mode: 'insensitive' } },
      { productType: { contains: input.query, mode: 'insensitive' } }
    ];
  }

  // Price filter (variants)
  if (input.price_min || input.price_max) {
    where.variants = {
      some: {
        ...(input.price_min ? { price: { gte: input.price_min } } : {}),
        ...(input.price_max ? { price: { lte: input.price_max } } : {})
      }
    };
  }

  // Tag filter — uses ProductTag table from 005a
  if (input.tags?.length) {
    where.tags = {
      some: {
        value: { in: input.tags },
        excluded: false  // skip excluded tags
      }
    };
  }

  // Taxonomy filter
  if (input.taxonomy) {
    const node = await prisma.taxonomyNode.findFirst({
      where: { shopDomain, slug: input.taxonomy }
    });
    if (node) where.taxonomyNodeId = node.id;
  }

  const products = await prisma.product.findMany({
    where,
    take: Math.min(input.limit ?? 6, 12),
    orderBy: { createdAt: 'desc' },
    include: {
      variants: { take: 1, orderBy: { price: 'asc' } },
      tags: { where: { excluded: false }, select: { axis: true, value: true } }
    }
  });

  return {
    products: products.map(formatProductCard),
    total: products.length,
    query: input
  };
}

function formatProductCard(product): ProductCard {
  const variant = product.variants[0];
  return {
    id: product.id,
    handle: product.handle,
    title: product.title,
    image: product.featuredImage || null,
    price: variant?.price ?? 0,
    compareAtPrice: variant?.compareAtPrice ?? null,
    currency: variant?.currency ?? 'USD',
    variantId: variant?.shopifyVariantId,
    available: variant?.available ?? false,
    tags: product.tags.map(t => `${t.axis}:${t.value}`),
    productUrl: `/products/${product.handle}`,
  };
}
```

### 5.2.3 Tool result returned to Claude

```json
{
  "products": [
    { "id": "...", "title": "Linen Kurta", "price": 2999, ... },
    ...
  ],
  "total": 6,
  "query": { "query": "kurta", "price_max": 3000 }
}
```

Claude reads this and writes the natural-language response: "Here are 6 kurtas under ₹3000. The Linen Kurta in white is great for daily wear..."

### 5.2.4 Acceptance
- [ ] Returns up to 12 products matching the input filters
- [ ] Respects shopDomain isolation (no cross-shop leakage)
- [ ] Skips draft/archived products
- [ ] Skips excluded tags
- [ ] Sub-100ms execution time
- [ ] Tool result is valid JSON, parseable by Claude

## 5.3 Rich Product Card Rendering in Widget

### 5.3.1 Updated response shape from /api/chat/message

The widget already expects:
```ts
{ message: { content, suggestions } }
```

Now extends to:
```ts
{ message: { content, suggestions, products?: ProductCard[] } }
```

### 5.3.2 Widget rendering changes

In `chat-widget.js`, the message rendering function gains a section for product cards:

```
[assistant message bubble — text only]
[product cards row — horizontal scroll on mobile, grid on desktop]
[suggestion chips — only for the latest message]
```

Card design:
- Width: ~200px (3 visible on desktop, scrollable on mobile)
- Image: 1:1 ratio, lazy loaded
- Title: 2 lines max with ellipsis
- Price: bold, currency-formatted
- Compare-at price (if on sale): strikethrough above
- "View" button — links to product page (storefront route)
- "Add to cart" button — calls `window.__aistylist.addToCart(variantId)`

### 5.3.3 Card styling

Following 007's Shadow DOM pattern. Cards use the same `--primary-color` CSS variable for accents (Add to cart button, hover states).

### 5.3.4 Acceptance
- [ ] Cards render below assistant text bubble
- [ ] 1-12 cards display correctly in row
- [ ] Mobile: horizontal scroll with momentum
- [ ] Desktop: grid wraps to multiple rows if >3 cards
- [ ] Image lazy loading works (no FOUC on scroll)
- [ ] Click on card image or title → opens product page in same tab
- [ ] Add to cart button → triggers cart.add flow
- [ ] Cards respect Shadow DOM isolation (theme CSS doesn't leak in)

## 5.4 Add-to-Cart Wiring

### 5.4.1 Storefront API: `/cart/add.js`

Shopify's storefront cart API accepts POST to `/cart/add.js`:

```ts
fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: variantId, quantity: 1 })
})
.then(r => r.json())
.then(data => { /* success */ })
.catch(err => { /* show error */ });
```

This works automatically because the widget runs on the `*.myshopify.com` storefront. Same-origin = no CORS issue.

### 5.4.2 UX flow

1. User clicks "Add to cart" on a product card
2. Button shows "Adding..." spinner
3. POST `/cart/add.js`
4. On success: toast "Added to cart" + refresh cart icon if visible on theme
5. On failure (out of stock, etc.): toast "Couldn't add — please check the product page"

### 5.4.3 Cart icon refresh

Some Shopify themes show a cart count icon. After adding, fire a custom event the theme might listen for:

```js
document.dispatchEvent(new CustomEvent('cart:refresh', { detail: { variantId } }));
```

If the theme doesn't listen, the icon won't update until next page nav. Acceptable degradation.

### 5.4.4 Acceptance
- [ ] Button click triggers /cart/add.js POST
- [ ] Loading state visible during request
- [ ] Success toast shows briefly
- [ ] Error toast shows for failures
- [ ] Cart count badge in theme updates if theme listens for cart:refresh event
- [ ] Out-of-stock items show error gracefully

## 5.5 Cost Guards

### 5.5.1 Why we need them

Anthropic API costs add up. If a malicious bot floods our chat endpoint with long messages, we burn money. Need guardrails.

### 5.5.2 Limits to enforce

Per session (rate limit):
- Max 30 messages per session per hour
- Max 1000 input tokens per single message (roughly 4000 chars)

Per shop (cost cap):
- Max 1000 chat requests per shop per day (configurable per merchant in 008b — for v1, hardcoded)

### 5.5.3 Implementation

In `cost-guards.server.ts`:

```ts
const sessionLimits = new Map<string, { count: number; resetAt: number }>();
const shopLimits = new Map<string, { count: number; resetAt: number }>();

export async function assertWithinLimits(shopDomain: string, sessionId: string) {
  // Reuse 007's in-memory rate limiter pattern
  const session = sessionLimits.get(sessionId);
  if (session && session.count >= 30 && Date.now() < session.resetAt) {
    throw new RateLimitError("Too many messages, please wait a few minutes.");
  }
  // ... shop limits, token limits, etc.
}
```

Same v1-limitation note as 007's rate-limiter: in-memory, doesn't survive restart, doesn't coordinate across replicas. Fine for v1. v2 moves to Redis.

### 5.5.4 Token budget per message

Hard cap: 4000 chars input, 1024 output tokens. If user types something longer, truncate before sending to Claude. Returns same response style — no surprise behavior.

### 5.5.5 Acceptance
- [ ] Session rate limit returns 429 after threshold with friendly message
- [ ] Shop cost cap returns 503 after threshold ("AI capacity exceeded today")
- [ ] Token cap silently truncates oversized inputs
- [ ] Limits reset on schedule (hourly for session, daily for shop)

## 5.6 Mode-Aware System Prompts

### 5.6.1 The system prompt builder

```ts
export function buildSystemPrompt(config: MerchantConfig): string {
  const shopName = config.shopName ?? 'this store';
  const agentName = getEffectiveAgentName(config);

  const base = `You are ${agentName}, a shopping assistant for ${shopName}. Your job is to help customers find products they'll love.

You have access to a product search tool. Use it whenever the user wants to find, browse, or compare products. Be specific in your search queries — extract attributes like color, material, occasion, price range from what the user says.

When products are returned, write a natural recommendation in 1-3 sentences. Do not list product names mechanically — pick the most relevant 2-3 and describe why they fit. The product cards will display below your message automatically; do not include URLs, prices, or images in your text.

Tone: friendly, concise, helpful. Avoid emoji. Avoid sales-y language.

If you don't know something, say so. Don't make up product details.`;

  const modeContext = MODE_CONTEXT[config.storeMode];
  return `${base}\n\n${modeContext}`;
}

const MODE_CONTEXT = {
  FASHION: `${shopName} sells clothing and accessories. Common queries: outfit advice, size questions, occasion-based requests, gift recommendations. The catalog is tagged with: gender, fit, material, occasion, style, size, color.`,

  JEWELLERY: `${shopName} sells jewellery (rings, necklaces, earrings, bangles, etc.). Many products have purity (22k, 18k, 925), gemstones, and craft type (kundan, polki, meenakari) attributes. Common queries: bridal collections, gifts, daily wear, men's jewellery. Be respectful of cultural context — bridal jewellery is significant.`,

  ELECTRONICS: `${shopName} sells electronics and gadgets. Common queries: feature comparisons, compatibility (works with iPhone? Android?), use cases (gaming, professional, content creation). Tags include: connectivity, color, target_user.`,

  FURNITURE: `${shopName} sells furniture. Common queries: room planning, dimensions, style fit (modern, rustic, etc.), assembly. Be aware of room context (living, bedroom, dining, outdoor).`,

  BEAUTY: `${shopName} sells beauty and personal care products. Common queries: skin/hair concerns, ingredient questions (vegan, cruelty-free), routines. Be sensitive to skin type variations.`,

  GENERAL: `${shopName} sells a variety of products. Help the customer find what they need; ask clarifying questions if intent is unclear.`
};
```

### 5.6.2 Why this works

- The base prompt is universal — agent identity, tool usage rules, tone
- The mode context is appended — gives Claude the "vocabulary" of this store
- Adding a new mode (or splitting JEWELLERY into bridal vs daily wear) is just adding to MODE_CONTEXT
- Stylist agent in 010 will append more tool descriptions + storyteller-mode language

### 5.6.3 Acceptance
- [ ] Each storeMode produces distinct, sensible prompts
- [ ] Tone is consistent across modes
- [ ] Tool usage rules are clear (Claude doesn't get distracted)
- [ ] Mode-specific vocabulary is hinted at without being prescriptive

## 6. Implementation Order

Tonight (Phase 1, 3-4 hours): Backend foundation that *works* even if widget doesn't render rich cards yet.

1. Schema additions if any (probably none — using 005a/006a tables)
2. `app/lib/chat/agent.server.ts` — orchestrator skeleton
3. `app/lib/chat/tools/search-products.server.ts` — tool implementation
4. `app/lib/chat/prompts.server.ts` — mode-aware system prompts
5. Update `app/routes/api.chat.message.tsx` to call agent instead of canned responses
6. `app/lib/chat/cost-guards.server.ts` — token + rate limits

Tomorrow (Phase 2, 2-3 hours): Widget rendering + Add-to-Cart.

7. Update `chat-widget.js` to render product cards inline with messages
8. Wire `Add to cart` button to /cart/add.js
9. Cart refresh event dispatch
10. Mobile-responsive product card layout

Tomorrow (Phase 3, 2-3 hours): Polish + edge cases.

11. Loading states (typing indicator while Claude is thinking)
12. Error handling (Claude API down, tool failure, no results)
13. Empty state UI ("No products matched — try different keywords")
14. Image fallback when product has no featured image
15. Smoke test on dev storefront

Each phase ends green: lint + typecheck + build.

## 7. Files to Create / Modify

### Created
```
app/lib/chat/agent.server.ts                  ~300 lines
app/lib/chat/tools/search-products.server.ts  ~150 lines
app/lib/chat/tools/types.ts                   ~50 lines
app/lib/chat/prompts.server.ts                ~80 lines
app/lib/chat/cost-guards.server.ts            ~100 lines
app/lib/chat/conversation.server.ts           ~60 lines
```

### Modified
```
app/routes/api.chat.message.tsx               (delegate to agent.server.ts)
app/lib/chat/canned-responses.server.ts       (kept as fallback for errors)
extensions/storefront-widget/assets/chat-widget.js  (rich card rendering + add-to-cart)
```

### Removed
None — keep `canned-responses.server.ts` as a fallback when Claude API fails.

## 8. Open Questions

1. **What happens when Claude API is down?** Recommend: graceful fallback to canned responses. User sees "I'm having trouble right now — please try again in a moment" + suggestion chips. Log the error for ops monitoring.

2. **What about empty search results?** Recommend: Claude already handles this — if tool returns 0 products, Claude writes "I couldn't find anything matching that. Could you try different keywords?" The message has 0 product cards, just text + suggestions.

3. **Conversation memory: include tool results in history sent to Claude?** Recommend: yes, but only the abbreviated form (just product titles + IDs). Full product data per turn would balloon the token count. Trade-off: Claude has slightly less context about previous results, but that's fine.

4. **Multi-language responses?** Recommend: English only for v1. Claude's system prompt is in English. v2 detects user language and switches.

5. **What about storeMode change mid-conversation?** Edge case: merchant changes storeMode while user is mid-chat. Recommend: each request loads merchant config fresh, so storeMode flips immediately. The chat doesn't crash — just gets different vocabulary in subsequent responses.

6. **Token usage tracking — show to merchant?** Recommend: log to Postgres for v1 (per-shop daily token usage), surface in merchant admin in 008b. Helpful for cost transparency.

7. **What if a product is sold out at request time vs add-to-cart time?** Recommend: search tool returns `available` field; cards show "Out of stock" if false; add-to-cart fails gracefully with toast.

8. **Markdown in Claude responses?** Recommend: Claude's text is plain text. We don't render markdown for v1 (XSS-safe). If Claude returns bullets/headers, they'll show as plain text — fine for v1.

9. **Suggestions chips — Claude generates or backend computes?** Recommend: backend computes from a small fixed set per storeMode + per response context. Simpler than asking Claude to generate them, more predictable.

10. **Product image fallback?** Recommend: if `featured_image` is null, show a simple text-based card with title + price, no image area. Most products will have images.

11. **What if user message is in caps lock or has profanity?** Defer. Not v1 concern. Could add basic toxicity filter in v2.

12. **Claude refuses to use tool for a specific product type?** Recommend: this shouldn't happen with current models. If observed in testing, refine system prompt to encourage tool use more.

## 9. Risk Areas

- **Latency.** Tool calls add ~1-2s to response time vs no-tool. With Sonnet's typical first-token latency + tool execution + second Claude call, expect 1500-3500ms total. Mitigate: typing indicator already in place from 007; user perceives this as "thinking."
- **Streaming responses.** We're NOT streaming in v1. The full response comes back in one POST. Streaming with tool calling is more complex (need SSE or chunked HTTP). Defer to v2 for "Claude is typing..." real-time effect. The artificial 600ms delay + actual response time covers this for now.
- **Token cost on long conversations.** With 10 messages of history + system prompt + tool results, token cost per request grows. ~$0.01-0.05 per request typically. Monitor in Phase 3 with token usage logging.
- **Claude tool calling reliability.** Sonnet 4.5 is reliable at tool calling but occasionally gets confused. Mitigate: clear tool descriptions, system prompt explicitly tells it to USE tools when relevant, fallback to plain response if tool execution errors.
- **Product data freshness.** Postgres data is synced via webhooks from 005a. If a product is deleted or stock changes between sync and search, results might be slightly stale. Acceptable for v1.
- **Shop isolation.** Critical: every Postgres query MUST filter by `shopDomain`. Bug here = cross-shop data leakage = severe security issue. Add tests + code review.
- **Add-to-cart same-origin assumption.** `/cart/add.js` only works because widget runs on `*.myshopify.com`. If we ever add iframe fallback or test on a non-Shopify domain, cart breaks. Document assumption.

## 10. Out of Scope

- Real-time streaming responses
- Stylist capability (010)
- Lookbook (014)
- Cart actions beyond add-to-cart (modify, remove, update qty — 012)
- Checkout flow customization (013)
- Customer account integration / order history queries (011)
- Voice input
- File / image input by user
- Conversation export / save
- Merchant-side conversation review tools
- Multi-shop unified search (cross-merchant catalog discovery)
- Fuzzy / semantic search (we're using exact title/description matching for v1)
- Pagination of search results (just return top N)
- Product comparison side-by-side UI
- Wishlist / favorites in chat
- Coupons / discounts in chat

## 11. Migration & Deploy Safety

- No schema changes — uses 005a + 006a tables.
- No new theme app extension — widget JS update only.
- `shopify app deploy` needed when widget JS changes (extension assets).
- Anthropic API key: already set in Railway (.env). Verify before deploy.
- Failed Claude calls: graceful degradation to canned response, never crash.
- Rolling deploy safety: response shape extended (added `products` field) — old widget versions just ignore the field, see text-only response. Backward compatible.

## 12. Demo Story After 008 Ships (Combined Phase 1+2)

1. Customer visits storefront, opens chat
2. Types: "show me linen kurtas under ₹3000"
3. Typing indicator appears
4. Claude responds in 1-2 seconds: "Here are some linen kurtas under ₹3000. The white Mandarin Collar Kurta is great for daily wear, and the yellow chambray would be perfect for festive occasions."
5. Below the message: 3-6 actual product cards from your 2632 catalog, with images, prices, View + Add-to-Cart buttons
6. User clicks "Add to cart" on one
7. Toast: "Added to cart"
8. Header cart icon updates (if theme listens)
9. User types follow-up: "what about something more formal?"
10. Claude searches with refined query, returns formal options
11. Conversation continues coherently — Claude remembers previous context

This is a **real AI shopping assistant** that does real product discovery on real merchant data. It's the demo that turns a project into a product.

---

*008 is the moment the project crosses the threshold from "infrastructure with a chat shell" to "actually intelligent commerce assistant." Everything before this was preparing the foundation. Everything after this is extending capabilities (stylist, lookbook) on top of the agent system this feature creates.*
