# Feature 007 — Storefront Chat Widget Shell

**Status:** Draft
**Depends on:** 005a-d, 006a (merchant config, taxonomy/rules exist; widget toggle lives in MerchantConfig)
**Blocks:** 008 (agent orchestrator), 009 (commerce agent), 010 (stylist agent), 011 (quiz engine)
**Owner:** Midhun

---

## 1. Why

Everything shipped so far has been merchant admin. 007 is the buyer-facing pivot — what the actual end customer sees on the merchant's storefront. After 007 ships, you can demo: install the app on a dev store, browse the storefront as a customer, see a floating chat bubble, click it, get a polished welcome experience.

007 is the **shell** — UI, plumbing, session management, config toggles. The chat backend returns hardcoded canned responses with realistic animations so the loop feels alive. Real intelligence lands in 008 (agent orchestrator) and 009 (commerce agent), which plug into the same backend endpoint without changing anything in this widget.

## 2. Goals & Non-Goals

### Goals
- Floating chat bubble auto-injected on every storefront page (App Embed extension)
- Product-page CTA button next to Add to Cart that opens chat with product context (App Block extension)
- Modern UX: spring animations, typing indicator, message bubbles, suggested chips, mobile-responsive
- Web Component with Shadow DOM for theme-proof CSS isolation
- Hardcoded canned response backend (`/api/chat/message`) — zero AI cost
- Anonymous session management via cookie UUID
- Merchant config toggles (enable widget, enable CTA, primary color, welcome message)
- Industry-neutral default copy (no fashion-specific text in placeholders)

### Non-Goals (deferred)
- Real AI/agent backend — 008+
- Quiz, lookbook, image upload — 011, 014, 018
- Cart/checkout actions in chat — 012/013
- Customer account linking — defer to 011
- Analytics events for chat interactions — 015
- Multi-language support — defer
- Voice input — defer
- File uploads in chat — defer
- Persistent chat history across sessions — defer (anonymous UUID is per-cookie, not persisted in DB for v1)
- Custom widget logo/avatar upload — defer

## 3. Architecture

### 3.1 Why Web Component + Shadow DOM (not iframe, not raw inline DOM)

Three options for injecting a widget into a Shopify storefront:

| Approach | Theme CSS isolation | Modern animations | First paint | Recommended? |
|---|---|---|---|---|
| Iframe | ✅ Bulletproof | ❌ Limited (can't span iframe boundary) | ❌ Slower | No |
| Raw inline DOM | ❌ Theme CSS leaks | ✅ Full | ✅ Fast | No |
| **Web Component + Shadow DOM** | ✅ Bulletproof | ✅ Full | ✅ Fast | **Yes** |

Shadow DOM creates a CSS scope boundary. Theme styles cannot leak in; our styles cannot leak out. We get iframe-like isolation with inline-DOM performance and animation freedom. This is the pattern Shopify itself uses for Polaris web components (`<s-button>`, `<s-banner>`, etc.) so the framework primitives align.

### 3.2 Theme App Extensions

Two extensions:

**App Embed (`extensions/storefront-widget/`)** — auto-loads the chat bubble on every storefront page when the app is enabled in the theme editor. No merchant placement needed.

**App Block (`extensions/storefront-cta/`)** — merchant-placeable button that goes near Add to Cart on product pages. Sends product context to the chat when clicked.

Both extensions use Shopify's [`liquid + assets/script.js`] pattern for theme app extensions.

### 3.3 Backend endpoint

`POST /api/chat/message` lives on the existing Railway server. Same auth pattern as other public APIs — no Shopify auth required (it's a public endpoint hit by anonymous storefront visitors).

For 007: returns hardcoded canned responses based on a small set of triggers (greeting, fallback, suggested-chip click).

For 008+: same endpoint, but routes through agent orchestrator. Widget code never changes — the backend's intelligence does.

### 3.4 Session model

Anonymous session UUID stored in cookie `aistylist_session_id`. Generated on first widget interaction, sent with every chat request. No DB persistence for v1 — the backend is stateless and just echoes back canned responses.

When 011 (quiz / account) ships, the cookie can be linked to a Shopify customer ID if available.

## 4. The Six Sub-Features

### 4.1 Floating Bubble (App Embed)
### 4.2 Product Page CTA (App Block)
### 4.3 Chat Widget UI (Web Component)
### 4.4 Backend Endpoint
### 4.5 Merchant Config UI
### 4.6 Storefront Storefront Token / Public API Auth

Each gets its own §5.x section.

## 5.1 Floating Bubble

### 5.1.1 What it is
A 56px circular button fixed to bottom-right of every storefront page. Tap → opens the chat panel.

### 5.1.2 Visual design

**Default state:**
- 56×56px circle
- Background: merchant's `chatPrimaryColor` (default `#000000`)
- Foreground icon: chat bubble + small AI sparkle indicator, white
- Drop shadow: `0 4px 16px rgba(0, 0, 0, 0.15)`
- Hover: scale to 1.05, slight shadow expansion
- Active / pressed: scale to 0.95
- First-load: subtle pulse animation (2s, 3 cycles, opacity 0.8 → 1.0 with scale 1.0 → 1.03)

**With unread count (future, defer):**
- Red dot in top-right of bubble for new messages

**Hidden state:**
- When chat panel is open, bubble fades out (or transforms into close button — tbd in §8)

### 5.1.3 Position
- Mobile: `bottom: 16px; right: 16px`, respect safe-area inset
- Desktop: `bottom: 24px; right: 24px`
- Z-index: 999998 (just below modal/overlay layers, above page content)

### 5.1.4 Implementation
Liquid template `extensions/storefront-widget/blocks/chat-embed.liquid`:
- Loads `<script src="{{ 'chat-widget.js' | asset_url }}" defer></script>`
- Loads merchant config as inline JSON `<script>window.__AISTYLIST_CONFIG__ = { ... }</script>`
- Defines `<aistylist-widget></aistylist-widget>` custom element placeholder

The script registers the custom element which renders into Shadow DOM.

### 5.1.5 Acceptance
- [ ] Bubble appears bottom-right on every storefront page
- [ ] Pulse animation runs once on first paint
- [ ] Click opens chat panel with spring animation
- [ ] Doesn't conflict with merchant's existing storefront chrome
- [ ] Mobile-responsive (smaller bottom margin, safe-area aware)
- [ ] Survives theme switching

## 5.2 Product Page CTA (App Block)

### 5.2.1 What it is
A merchant-placeable button on product pages. Default label "Ask AI Stylist" (configurable). Clicking opens the chat with the current product as context.

### 5.2.2 Visual design

**Default state:**
- Full-width button on mobile, inline on desktop
- Background: merchant's `chatPrimaryColor` with 10% opacity (subtle, not loud)
- Border: 1px solid `chatPrimaryColor`
- Text: `chatPrimaryColor` at full opacity
- Icon: chat bubble + sparkle, left-aligned
- Hover: solid background, white text
- Active: scale 0.98

### 5.2.3 Placement
The merchant drops this block in their product page template via the theme editor. Recommended placement: directly below Add to Cart.

### 5.2.4 Product context
When clicked, the CTA passes:
- Product handle
- Product title
- Selected variant ID
- Featured image URL

To the widget via `window.__aistylist.openWithContext({ product })`. Widget shows context pill at top of chat: "Asking about: {product title}" with the product image thumbnail.

### 5.2.5 Configuration
Merchant can edit in theme editor:
- Button label (default "Ask AI Stylist")
- Show/hide icon
- Position relative to Add to Cart (above / below — Shopify theme block ordering)

### 5.2.6 Acceptance
- [ ] Block can be added to product page template
- [ ] Clicking opens chat with product context pill visible
- [ ] Style matches merchant's primary color
- [ ] Works on mobile and desktop
- [ ] Doesn't double-fire (tap once, single message context)

## 5.3 Chat Widget UI (Web Component)

This is the bulk of the work. Lives in `extensions/storefront-widget/assets/chat-widget.js`.

### 5.3.1 Component tree

```
<aistylist-widget>  ← custom element (host)
  #shadow-root
    <div class="bubble">  ← floating button
    <div class="panel" data-open={true|false}>
      <header>
        <div class="branding">AI Stylist</div>
        <button class="close" />
      </header>
      <div class="context-pill" data-visible={hasContext}>...</div>
      <div class="messages">
        <div class="message" data-role="assistant|user">...</div>
        <div class="typing-indicator">...</div>
      </div>
      <div class="suggestions">
        <button class="chip">...</button>
      </div>
      <footer>
        <input class="input" />
        <button class="send" />
      </footer>
    </div>
```

### 5.3.2 State

```ts
type WidgetState = {
  open: boolean;
  messages: Message[];
  typing: boolean;
  context: ProductContext | null;
  sessionId: string;  // UUID from cookie
  inputValue: string;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  suggestions?: string[];  // chips shown after this message
};
```

State managed via simple class methods + `requestUpdate()` re-renders. No framework — vanilla web component for size and zero deps.

### 5.3.3 Open/close animation

**Opening:**
1. Bubble fades out (200ms)
2. Panel scales from `transform: scale(0.95) translateY(20px)` to `scale(1) translateY(0)` with `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring overshoot) over 400ms
3. Opacity 0 → 1 over the same 400ms

**Closing:**
1. Panel scales back to `0.95 translateY(20px)` and fades to 0 over 250ms
2. Bubble fades back in over 200ms

### 5.3.4 Welcome state (first open, no messages)

- Greeting message from assistant: "Hi! I'm your shopping assistant. How can I help you today?"
- 3-4 suggested chips below: industry-neutral examples
  - "Show me what's new"
  - "Help me find a gift"
  - "What's trending?"
  - "I'm just browsing"
- These chips are configurable per merchant in 011+ (defer); for 007 they're hardcoded industry-neutral defaults

If opened with product context (CTA click):
- Greeting: "Hi! Want help with this {product type}?"
- Chips:
  - "Tell me more about it"
  - "Show me similar items"
  - "How does it fit?" (FASHION-only — gate by storeMode if available; default neutral copy otherwise)

Note: Even though storeMode is FASHION/JEWELLERY/etc., the welcome chips stay generic for v1. Mode-aware chips can come in 011 when quiz/onboarding ships.

### 5.3.5 Sending a message

User types → presses Enter or clicks send:
1. User message bubble appears immediately (optimistic)
2. Input clears
3. Typing indicator appears (3 animated dots)
4. POST `/api/chat/message` with `{ sessionId, text, context, history: last 10 messages }`
5. Wait for response (artificially delay min 600ms so typing feels real even on fast responses)
6. Typing indicator disappears
7. Assistant message bubble slides in

### 5.3.6 Typing indicator

Three dots with staggered bounce animation:
```
. . .
  ↓
.   . .
.     .   .
```
Each dot: 4px circle, opacity 0.4, animates `translateY(-4px)` and `opacity: 1` with 0.6s loop, 0.2s stagger between dots.

### 5.3.7 Message bubble design

**User messages (right-aligned):**
- Background: `chatPrimaryColor`
- Text: white
- Border-radius: 16px (top-left), 16px (top-right), 4px (bottom-right), 16px (bottom-left)
- Max-width: 80% of panel
- Padding: 10px 14px

**Assistant messages (left-aligned):**
- Background: `#F4F4F5` (neutral gray)
- Text: `#18181B` (near-black)
- Border-radius: 16px / 16px / 16px / 4px (mirrored)
- Same constraints

**Animation on arrival:** scale 0.9 → 1, opacity 0 → 1, translateY 8px → 0, 250ms ease-out.

### 5.3.8 Mobile responsive

Below 640px viewport:
- Panel: full-screen overlay (`width: 100vw; height: 100vh`)
- Bubble: smaller (48px), tighter margin
- Input: larger touch target (52px height)
- Safe-area aware: `padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom)`

### 5.3.9 Keyboard support

- Esc closes panel
- Enter sends message
- Shift+Enter adds newline (but for v1, single-line input only — defer multi-line)
- Tab cycles through suggested chips → input → send button → close
- Arrow keys: defer

### 5.3.10 Accessibility

- `role="dialog"` on panel
- `aria-label="Chat with AI Stylist"` on host element
- `aria-live="polite"` on messages container so screen readers announce new messages
- Focus trap when panel is open
- Focus returns to bubble when panel closes

### 5.3.11 CSS isolation
All styles inside Shadow DOM. No global CSS. Every selector is auto-scoped.

```css
/* example excerpt */
:host {
  --primary-color: #000;
  --primary-fg: #fff;
  /* ... */
}
.bubble { ... }
.panel { ... }
```

The `:host` block reads CSS custom properties from `window.__AISTYLIST_CONFIG__.primaryColor` at init time.

### 5.3.12 Acceptance
- [ ] Bubble + panel render in Shadow DOM (verifiable in DevTools — `<aistylist-widget>` with shadow)
- [ ] Spring animation on open/close
- [ ] Typing indicator with 3 staggered dots
- [ ] Messages animate in
- [ ] Suggested chips clickable, sends preset message
- [ ] Input + send works (Enter or click)
- [ ] Esc closes
- [ ] Mobile: full-screen overlay, safe-area aware
- [ ] Theme CSS does not affect widget (test by adding aggressive theme CSS like `* { color: red !important; }` — widget unchanged)

## 5.4 Backend Endpoint

### 5.4.1 Spec

`POST /api/chat/message`

**Request body:**
```ts
{
  sessionId: string;       // UUID from cookie
  text: string;            // user message
  context?: ProductContext;
  history: Message[];      // last N messages from widget state
  shopDomain: string;      // identifies the merchant
}
```

**Response body:**
```ts
{
  message: {
    id: string;
    role: 'assistant';
    content: string;
    timestamp: number;
    suggestions?: string[];
  };
}
```

### 5.4.2 Hardcoded response logic (v1)

The backend logic is intentionally simple. Pattern-match on user text:

```
if first message → return greeting + welcome suggestions
if text matches /^show me|find|looking for/i → return "I'd love to help you find something! Real product search coming soon."
if text matches /thank|thanks/i → return "You're welcome! Anything else?"
if context present → return "Got it, you're asking about {product.title}. Real product help coming soon."
otherwise → return "Thanks for that! I'm still learning. The full AI experience launches soon."
```

Suggestions returned with each response: 2-4 industry-neutral chips so the conversation always has a next step.

### 5.4.3 Auth model

**No Shopify auth required.** This is a public endpoint hit by anonymous storefront visitors.

To prevent abuse:
- Rate limit by IP: 30 requests/minute (in-memory limiter)
- Rate limit by sessionId: 60 requests/minute
- Validate `shopDomain` against installed shops (if no Session row exists for that domain, reject)

The `shopDomain` validation prevents random external clients from hitting our endpoint.

### 5.4.4 Acceptance
- [ ] POST returns 200 with message body
- [ ] Pattern matching works for greeting/help/thanks
- [ ] Rate limit returns 429 after threshold
- [ ] Invalid shopDomain returns 401
- [ ] Response time always ≥ 600ms (artificial delay so typing feels real even on instant returns)

## 5.5 Merchant Config UI

### 5.5.1 New fields on MerchantConfig

```prisma
// Add to MerchantConfig
chatWidgetEnabled    Boolean  @default(true)
chatPrimaryColor     String   @default("#000000")
chatWelcomeMessage   String   @default("Hi! I'm your shopping assistant. How can I help you today?")
chatBubbleLabel      String?  // optional label next to bubble (defer in UI for v1)
ctaProductPageEnabled Boolean @default(true)
ctaButtonLabel       String   @default("Ask AI Stylist")
```

### 5.5.2 Configuration page additions

`/app/config` (existing page) gets a new "Chat widget" section with:
- Toggle: Enable chat widget on storefront
- Color picker: Primary color (with default #000000)
- Text input: Welcome message
- Toggle: Enable product page CTA
- Text input: CTA button label

Use existing Polaris form components.

### 5.5.3 Storefront fetches config

The widget needs to know the merchant's color/welcome message. Options:

**A. Inject config inline** in the App Embed liquid template:
```liquid
<script>
  window.__AISTYLIST_CONFIG__ = {
    shopDomain: "{{ shop.permanent_domain }}",
    primaryColor: "{{ block.settings.primary_color }}",
    welcomeMessage: "{{ block.settings.welcome_message }}",
    chatEndpoint: "{{ block.settings.chat_endpoint }}"
  };
</script>
```

This pulls from theme app extension settings. The merchant configures these in the theme editor (App Embed settings panel).

**B. Fetch from API on widget load:** widget hits `GET /api/chat/config?shop=foo` to get primaryColor etc.

**Trade-off:** A is faster (no extra request) but requires merchant to set values twice (once in /app/config, once in theme editor settings). B is slower but single source of truth.

For 007, use **A with theme editor settings**. The /app/config Configuration page values become the *defaults* that get pre-filled into the theme app extension settings. Single source of truth via Shopify metafields would solve this fully but is over-engineering for v1.

Actually, simpler: **just use theme app extension settings as the source.** The /app/config page doesn't store these values at all in v1. Merchant configures the widget via theme editor only. 

Pros: zero sync issues, simpler v1.
Cons: merchant has to know to look in theme editor.

Counter-cons: that's standard for Shopify theme app extensions. Merchants are used to it.

**Decision: theme editor settings only.** Drop the MerchantConfig fields from §5.5.1 entirely. Reduces schema changes to zero in 007.

### 5.5.4 Acceptance
- [ ] Theme editor App Embed settings allow primary color, welcome message, enable toggle
- [ ] Theme editor App Block (CTA) settings allow label, icon toggle
- [ ] Widget reads these settings on load
- [ ] Changes propagate live to storefront after merchant saves theme

## 5.6 Storefront API Auth

### 5.6.1 Why this matters

The widget calls `/api/chat/message` from a storefront page. The fetch crosses domains (storefront `*.myshopify.com` → our Railway server). Need:

1. **CORS headers** on the endpoint allowing the storefront domain
2. **Identify the shop** via shopDomain in request body, validated against installed shops table

For v1, accept any installed shop's storefront. CORS allows `*.myshopify.com` and the merchant's custom domain (if set). Tightening to per-shop CORS is over-engineering for v1.

### 5.6.2 CORS config

In `app/routes/api.chat.message.tsx`:
```ts
const ALLOWED_ORIGINS = [/^https:\/\/[\w-]+\.myshopify\.com$/];
// optionally also allow merchant custom domain from Session record
```

Set `Access-Control-Allow-Origin` dynamically based on request origin matching the regex.

### 5.6.3 Acceptance
- [ ] Widget on storefront successfully POSTs to chat endpoint
- [ ] Direct request from random external origin gets 403
- [ ] OPTIONS preflight returns proper CORS headers

## 6. Implementation Order

1. **Theme app extension scaffolding** — `extensions/storefront-widget/` (App Embed) + `extensions/storefront-cta/` (App Block) via Shopify CLI scaffold
2. **Web component shell** — `<aistylist-widget>` registers, renders bubble + empty panel, opens/closes with animation
3. **Welcome state + suggestions** — first-open greeting, 3-4 chips
4. **Send message flow** — input handling, optimistic user bubble, typing indicator, fetch backend
5. **Backend endpoint** — `POST /api/chat/message` with hardcoded responses
6. **Product CTA App Block** — separate Liquid + script that calls `window.__aistylist.openWithContext()`
7. **Context pill** in widget — when opened with context, show product thumbnail + title pill above messages
8. **Theme editor settings** — App Embed + App Block expose configurable fields
9. **CORS + rate limit** on backend endpoint
10. **Polish pass** — spring animations, accessibility, mobile responsive
11. **Smoke test** — install on dev storefront, open bubble on home page, click CTA on product page, verify both flows

Each step ends green: lint + typecheck + build.

## 7. Files to Create

```
extensions/
  storefront-widget/             # App Embed
    shopify.extension.toml
    blocks/
      chat-embed.liquid          (~30 lines)
    assets/
      chat-widget.js             (~600 lines — the web component)
      chat-widget.css            (inline in JS, see §5.3.11)
  storefront-cta/                # App Block
    shopify.extension.toml
    blocks/
      ask-ai-stylist.liquid      (~50 lines)
    assets/
      cta-button.js              (~80 lines)

app/routes/
  api.chat.message.tsx           (~150 lines — endpoint with rate limit + canned responses)

app/lib/chat/
  rate-limiter.server.ts         (~60 lines — in-memory IP/session limiter)
  canned-responses.server.ts     (~100 lines — pattern-match logic)
  session.ts                     (~40 lines — UUID generation, cookie helpers)
```

## 8. Open Questions

1. **Bubble while panel open — fade out or transform into close button?** Recommend fade out (simpler, matches Intercom/Crisp). The header has its own close button.

2. **Position of suggestions chips — above input always, or only when no message has been sent?** Recommend: only on welcome state. After first user message, suggestions appear inline below the latest assistant message (per-message suggestions, response-driven).

3. **Send button: always visible, or only when input has text?** Recommend: always visible but disabled when empty. Visual feedback on focus + active states.

4. **Maximum chat history sent in request?** Recommend: last 10 messages. Enough for context, bounded for cost.

5. **Bubble pulse animation timing — once on first load only, or every time bubble re-appears?** Recommend: once per page load (sessionStorage flag). Don't pulse aggressively.

6. **Mobile: should bubble shrink on scroll-down (like some apps)?** Recommend: NO for v1. Adds complexity. Bubble stays put.

7. **Product CTA — what if multiple variants?** When merchant has color/size variants, which one is in context? Recommend: the currently-selected variant. The CTA reads `window.ShopifyAnalytics?.meta?.selectedVariantId` if present, else first variant.

8. **Privacy / cookie consent** — does the chat widget need cookie consent banner integration? Recommend: NO for v1. Anonymous session UUID is functional cookie, exempt from most consent regimes. Revisit if a merchant in a regulated jurisdiction asks.

9. **What happens when chatWidgetEnabled is false?** Recommend: liquid template renders nothing if the App Embed is disabled. App Block similarly disabled = block not added or hidden via theme editor.

10. **Scroll behavior when many messages** — auto-scroll to bottom on new message? Recommend: yes, but only if user is already near the bottom (within 100px). If they've scrolled up, don't yank them back — show a "new message" pill that scrolls down on click.

11. **Iframe fallback** — if Shadow DOM is unsupported on some old browser, fall back to iframe? Recommend: NO. Shadow DOM is universally supported in 2026 (all evergreen browsers, WebKit 10+). Drop the iframe fallback.

12. **Welcome message customization scope** — just text, or also greeting style (formal/casual)?  Recommend: just text. Tone variations come in 010 (stylist agent personality).

## 9. Risk Areas

- **Theme conflicts despite Shadow DOM.** Some themes use `!important` everywhere. Shadow DOM blocks this, but if a theme uses positioning conflicts (e.g., another fixed element bottom-right), our bubble might overlap. Mitigation: log conflicts in console for first-load debugging.
- **Mobile keyboard pushes panel off-screen.** When mobile keyboard appears, our 100vh panel doesn't shrink. Mitigation: use `100dvh` (dynamic viewport height) which accounts for keyboard. Fallback to `100vh` for older browsers.
- **Race condition on session UUID.** First widget open → generate UUID → first message → cookie not set yet → second tab generates different UUID. Mitigation: write cookie synchronously on UUID generation, before first fetch.
- **CSP (Content Security Policy) on merchant theme.** Some merchants use strict CSP that blocks inline scripts or external connections. Mitigation: document the required CSP allowlist (`connect-src https://web-production-3b1d7.up.railway.app`).
- **Bundle size.** Vanilla web component is small, but if we accidentally import a heavy lib, the bundle bloats. Target: < 30KB minified for chat-widget.js.

## 10. Out of Scope

- Real AI / agent backend (008+)
- Persistent chat history in DB (defer until 011)
- Customer account integration (defer to 011)
- Cart actions in chat (012/013)
- Lookbook in chat (014)
- Image upload by user (018)
- Voice / audio input
- Multi-language support
- A/B testing of bubble position / colors
- Analytics events (chat_started, chat_ended, message_sent — wire in 015)
- Merchant moderation tools (block users, etc.)
- Custom widget logo upload
- Deep theme branding (typography matching, etc.)

## 11. Migration Safety Notes

- 007 adds NO schema changes (configuration via theme editor, not DB).
- New theme app extensions need `shopify app deploy` to push to Partners — this is a separate manual step at the end of build.
- App Embed must be enabled by the merchant in their theme editor before the widget appears. Document this clearly.

## 12. Demo Story After 007 Ships

1. Install app on dev store
2. Open dev store theme editor → toggle on "AI Stylist Chat" embed
3. (Optional) Add "Ask AI Stylist" block to product page template
4. View storefront as customer
5. Floating chat bubble in bottom-right
6. Click → spring animation opens chat panel
7. Welcome message + 3 suggested chips
8. Click a chip → message appears, typing indicator, response slides in
9. Type a message → same flow
10. Navigate to a product page (if CTA enabled) → "Ask AI Stylist" button next to Add to Cart
11. Click CTA → chat opens with product context pill at top
12. Conversation with product context flows naturally

This is a coherent, demoable AI shopping assistant shell. Real intelligence in 008+.

---

*007 is the first thing your end customers see. After it ships, the project transitions from "merchant tooling" to "actual AI commerce product." The shell must feel polished even when responses are hardcoded — first impressions of the customer-facing UX set the bar.*
