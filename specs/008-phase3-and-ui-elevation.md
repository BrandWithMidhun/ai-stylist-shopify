# Feature 008 — Phase 3 + UI Elevation

**Status:** Draft
**Depends on:** 008 Phase 1 + 2 (orchestrator + commerce capability + product cards shipped)
**Blocks:** 010 (stylist agent), 014 (lookbook)
**Owner:** Midhun
**Estimated effort:** 4-5 hours

---

## 1. Why

Phase 1+2 shipped a *functionally* complete AI shopping assistant. Real Claude responses, real product cards, real Add-to-Cart. The plumbing works.

Phase 3 makes it feel like a *product*, not a demo. Two threads:

**A. Visual elevation:** the merchant's mockup specifies a polished design language that goes well beyond what we shipped. New header with avatar/status, "AI Pick" badges, structured card layout, branded touches. This is what makes the difference between "it works" and "I want this."

**B. Edge case polish:** out-of-stock badges, empty states, error handling, mobile verification, image fallback finalization. The UX corners that matter when real customers hit unexpected paths.

After Phase 3, 008 is *done* — feature-complete, demoable, and visually shippable.

## 2. Goals & Non-Goals

### Goals

**Visual elevation (per mockups):**
- Header redesign: agent avatar with sparkle icon, online status dot, two-line layout (name + subtitle)
- Cards: "AI Pick" badge, structured Add to Cart + View Details ↗ layout
- Cards header: "X MATCHES" with optional "See all" link (link is non-functional in v1)
- Welcome state: "SUGGESTED" label above chips
- Footer disclaimer: "AI may make mistakes. Verify important details."
- Input bar: image upload icon + mic icon (decorative only — non-functional in v1)
- PDP CTA redesign: "Ask {AgentName}" with sparkle icon

**Original Phase 3 polish:**
- "Out of stock" text label on disabled OOS cards (resolves Phase 2 todo)
- "Price on request" or hidden price row when price=0
- Empty state for searches returning no products
- Error states: Claude API down, network failure
- Mobile responsiveness verification + fixes
- Image fallback finalization

**Naming:**
- Default agent name "Aria" for FASHION/JEWELLERY storeModes
- Default agent name "AI Assistant" for ELECTRONICS/FURNITURE/BEAUTY/GENERAL (unchanged from 007)
- Merchant override still works
- PDP CTA default copy changes from "Ask AI Stylist" to "Ask Aria" (but reads from agentName via metafield sync)

### Non-Goals (deferred to v2 / future features)
- Image upload functional — defer to 018 (image input feature)
- Mic input functional — defer indefinitely (voice is its own scope)
- Size pills functional (variant selection from chat) — defer to 012
- "See all" link to actual search results page — defer until search page exists
- Real-time message streaming — defer
- Conversation export
- Persistent chat history across sessions
- Customer account linking
- Multi-language responses
- Aria personality/tone variations
- Trademark check on "Aria" name (assume safe for dev; merchant override available before launch)

## 3. Design Spec — Visual Elevation

### 3.1 Header redesign

**Current state:** Simple "AI Stylist" text + close button.

**New state per mockup:**

```
┌─────────────────────────────────────────────┐
│  ⊙[avatar]  Aria                       — ✕  │
│             Your shopping assistant         │
└─────────────────────────────────────────────┘
```

**Components:**
- **Avatar circle**: 36×36px, dark background (#000 or theme primary), white sparkle icon centered
- **Status dot**: 10×10px green circle (#22C55E or similar), positioned bottom-right of avatar with 1px white border (creates the "indented" look)
- **Agent name**: bold, 16px, line 1
- **Subtitle**: "Your shopping assistant" — regular weight, 13px, muted color (#666), line 2
- **Header right**: minimize button (—) + close button (✕) — minimize is decorative for v1 (just non-functional, but visible)

**Layout:**
- Padding: 16px
- Border-bottom: 1px solid rgba(0,0,0,0.08) for separation from messages
- Background: white (current panel bg)

### 3.2 Welcome state

**Current state:** Simple welcome message + 4 chips.

**New state per mockup:**

```
[Avatar header]
┌─────────────────────────────────────────────┐
│  Hi, I'm Aria from {ShopName}. How can I    │
│  help you find your next favorite piece?    │
└─────────────────────────────────────────────┘

  SUGGESTED
  
  [Find me something under ₹3000]   [Help me choose size]
  [Show me best sellers]            [Create a complete look]
```

**Components:**
- Welcome message bubble: same as current, just with new copy
- "SUGGESTED" label: caps, 11px, muted color (#999), letter-spacing 0.5px, padding 16px 16px 8px
- Chips: same pill style, but slightly larger (10px font → 13px), more breathing room
- Chips wrap into 2-row grid on desktop (2x2 layout), single column on narrow mobile

**Welcome message copy:**
- Mode-aware via system prompt or static template (suggest static template for simplicity):
  - FASHION/JEWELLERY: "Hi, I'm {agentName} from {shopName}. How can I help you find your next favorite piece?"
  - ELECTRONICS: "Hi, I'm {agentName} from {shopName}. What can I help you find today?"
  - FURNITURE: "Hi, I'm {agentName} from {shopName}. Let me help you find the perfect piece for your space."
  - BEAUTY: "Hi, I'm {agentName} from {shopName}. Looking for something in particular?"
  - GENERAL: "Hi, I'm {agentName} from {shopName}. What can I help you find?"

**Welcome chip copy (mode-aware, defaults):**
- FASHION: "Find me something under ₹3000" / "Help me choose size" / "Show me best sellers" / "Create a complete look"
- JEWELLERY: "Find me a gift" / "Show me bridal collection" / "What's trending?" / "Help me choose size"
- ELECTRONICS: "Show me best sellers" / "Help me compare options" / "What's new?" / "I'm just browsing"
- FURNITURE: "Show me what's popular" / "Help me find a sofa" / "What's on sale?" / "I'm just browsing"
- BEAUTY: "Show me best sellers" / "Help me with my routine" / "What's new?" / "I'm just browsing"
- GENERAL: "Show me what's new" / "Help me find a gift" / "What's trending?" / "I'm just browsing"

These chips are static defaults. Merchant can't customize in v1. Future: theme editor settings to override per shop.

### 3.3 Product cards redesign

**Current state:** Image, title, price, View + Add to cart buttons.

**New state per mockup:**

```
┌─────────────────────────────────┐
│  ⭐ AI Pick                      │
│ ┌─────────────────────────────┐ │
│ │                             │ │
│ │      [Product Image]        │ │
│ │                             │ │
│ └─────────────────────────────┘ │
│  Oversized Cashmere Knit        │
│  ₹2,890                         │
│                                 │
│  ┌───────────────────────────┐  │
│  │   🛒  Add to Cart         │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │   View Details ↗          │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

**Components:**
- **AI Pick badge**: top-left corner, 11px text, semi-bold, with star icon, white background with subtle shadow, padding 4px 8px, border-radius 999px (pill), positioned absolute over the image area top-left
- **Image area**: full-width, 1:1 aspect ratio, larger than current (current is ~200px wide; new should be ~240-280px on desktop, full panel width on mobile)
- **Title**: 14px, semi-bold, 2-line ellipsis (line-clamp:2), color #18181B
- **Price**: 16px, bold, color #18181B
- **Compare-at price** (if higher than price): strikethrough, 13px, muted color (#999), shown above current price OR inline before price
- **Add to Cart button**: primary action, full-width, dark background (theme primary color or #18181B), white text, 13px semi-bold, padding 12px, border-radius 999px (pill), shopping cart icon on the left
- **View Details button**: secondary action, full-width, transparent background, dark border (1px solid #E4E4E7), dark text, 13px, padding 12px, border-radius 999px (pill), arrow icon on the right (↗)

**Card layout:**
- Width: ~240px on desktop, ~280px on mobile
- Background: white
- Border: 1px solid #E4E4E7
- Border-radius: 16px
- Padding: 12px
- Inner gap between elements: 8-12px
- Hover state (desktop): subtle shadow lift `box-shadow: 0 4px 12px rgba(0,0,0,0.08)`

### 3.4 Cards header

**Current state:** Cards row appears directly under assistant message bubble.

**New state per mockup:**

```
[Assistant message bubble]

4 MATCHES                              See all →

[Card] [Card] [Card] [Card]
```

**Components:**
- "X MATCHES" label: caps, 12px, semi-bold, color #18181B
- "See all" link: right-aligned, 12px, muted color, with right-arrow icon
- Both on same row, padding 16px 0 8px, before the cards

**"See all" behavior in v1:**
- The link is rendered but goes to `/search?q={user_query}` (Shopify's standard search page) — non-functional in the sense that there's no integration, but Shopify's search will give a reasonable fallback experience
- Alternative: render the link but don't make it navigate (`href="#"` with `e.preventDefault()`) — flag as "Coming soon" in tooltip
- Recommendation: **link to /search?q=query** for v1 — works out of the box, gives users a path forward

### 3.5 Footer disclaimer

**Current state:** None.

**New state per mockup:**

Below the input bar:

```
[Input bar with icons]

AI may make mistakes. Verify important details.
```

**Components:**
- Text: 11px, color #999, centered, padding 8px 16px 12px
- No styling beyond muted text — purely informational

This is a legal/UX honesty marker. Standard for AI products in 2025-2026.

### 3.6 Input bar redesign

**Current state:** Plain text input + send button.

**New state per mockup:**

```
┌────────────────────────────────────────────────┐
│ [📷] Ask anything...           [🎤]    [↑]     │
└────────────────────────────────────────────────┘
```

**Components:**
- **Image upload icon (left)**: 20×20px icon, decorative for v1 — clicking shows toast "Image upload coming soon"
- **Text input**: placeholder "Ask anything..." (instead of "Type a message..."), full-width, no border (background distinguishes), padding 12px 16px
- **Mic icon (right of text)**: 18×18px, decorative — clicking shows toast "Voice input coming soon"
- **Send button (far right)**: replace paper plane (✈) with up-arrow (↑) per mockup — circular dark button, white arrow

**Layout:**
- Container: rounded pill (border-radius 999px), background #F4F4F5 (light gray), padding 4px 4px 4px 16px
- Send button: 36×36px circle, dark bg, white arrow, separate from input "fused" feel via flex gap

### 3.7 PDP CTA redesign

**Current state:** Outline-style button "Ask AI Stylist" full-width.

**New state per mockup:**

```
[Add to bag (full-width primary)]
[♡ Wishlist (icon button)]
       Free shipping & 30-day returns
                                 ┌──────────────────┐
                                 │ ⊙ Ask Aria       │
                                 └──────────────────┘
```

**Components:**
- **CTA pill button**: not full-width, ~140-180px wide, positioned bottom-right of the product info area
- Background: dark (theme primary or #18181B)
- Text: white, semi-bold, 13px
- Icon: avatar/sparkle on the left, 16×16px
- Border-radius: 999px (pill)
- Padding: 10px 16px

**Placement:**
- Floats below standard add-to-bag area, near "Free shipping" text
- On mobile: still pill style, same positioning logic
- Theme editor block setting controls placement (already exists in 007)

**Copy:** Default "Ask {agentName}" — reads agentName from metafield. So FASHION/JEWELLERY shows "Ask Aria"; ELECTRONICS shows "Ask AI Assistant".

### 3.8 OOS card variant

**Current state:** Add to cart button disabled (opacity 0.5), no text change.

**New state:**

When `available === false`:
- Add to Cart button text changes to "Out of Stock"
- Button still disabled (no click)
- Visual: same dark background but reduced opacity, or different color (lighter gray bg, dark text)
- View Details still works

This is a Phase 3 polish item from earlier — finally lands here.

### 3.9 Empty state

When tool returns 0 products (Claude searched but nothing matched):

Currently Claude says "I couldn't find anything matching that. Could you try different keywords?" in prose.

Phase 3 addition:
- Below the message, a small empty state UI:

```
[Magnifying glass icon, muted]

No matching products found

[Browse all products (CTA)]
```

Where "Browse all products" links to `/collections/all`. This gives users a clear next step instead of a dead end.

### 3.10 Error states

Three error scenarios + their UX:

**A. Claude API down:**
- Currently: graceful fallback to canned response from Phase 1
- Phase 3: small badge below message: "⚠ AI offline" with retry icon
- Tooltip on retry: "Tap to try again"

**B. Network error (POST /api/chat/message fails):**
- Toast: "Connection issue — please check your connection"
- Message stays in widget but assistant response shows ⚠ icon
- Retry button on the failed message

**C. Cart add fails:**
- Already handled in Phase 2 — toast: "Couldn't add — check the product page"
- Phase 3: refine toast styling to match new design

## 4. Implementation Plan

### 4.1 Updates to extensions/storefront-widget/assets/chat-widget.js

This is the main file to modify. Approximately +200-300 LOC for visual elevation, no structural refactor.

**Specific changes:**
1. New `_buildHeader()` — replaces current header with avatar + status + name + subtitle
2. New `_buildAvatar()` helper — SVG sparkle icon in circle
3. Update `_renderProductCards()` — add AI Pick badge, restructure card layout, OOS variant
4. New `_renderCardsHeader()` — "X MATCHES" + "See all" before cards
5. Update `_renderSuggestions()` — add "SUGGESTED" label above chips on welcome state
6. New `_buildFooter()` — disclaimer text below input
7. Update `_buildInputBar()` — image icon, mic icon, up-arrow send button
8. New `_renderEmptyState()` — for 0-product searches
9. New `_renderErrorBadge()` — for AI offline / network errors
10. CSS additions to STYLES template: ~150 lines for new visual elements

### 4.2 Updates to extensions/storefront-widget/blocks/ask-ai-stylist.liquid

Redesign PDP CTA per §3.7:
- Smaller pill button (not full-width)
- Avatar/sparkle icon on left
- Default label changes to "Ask Aria" but reads from metafield (existing mechanism)

### 4.3 Updates to app/lib/merchant-config.ts

Update `getDefaultAgentName(storeMode)`:
- FASHION → "Aria" (was "AI Stylist")
- JEWELLERY → "Aria" (was "AI Stylist")
- All others → "AI Assistant" (unchanged)

### 4.4 Updates to app/lib/chat/prompts.server.ts

Update welcome message templates per §3.2:
- Add `getWelcomeMessage(config)` helper that returns mode-aware welcome text
- Update system prompt's intro to reference {agentName} consistently

### 4.5 Updates to app/lib/chat/suggestions.server.ts

Update WELCOME_CHIPS to be mode-aware per §3.2:
- Function `getWelcomeChips(storeMode)` returns the right pool

### 4.6 No schema changes

Default agent name change is a code-level change. The chatAgentName field on MerchantConfig already exists. The default just resolves differently for new shops.

For existing shops:
- If chatAgentName is null (using default) → automatically picks up new "Aria" default
- If chatAgentName has a value → unchanged (merchant override stays)

This is automatic. No migration needed.

### 4.7 Metafield sync re-run

Merchants who installed before Phase 3 have their metafield populated with the OLD agent name. To pick up "Aria":
- Merchant just needs to re-save /app/config (any save triggers metafield sync with the new resolved default)
- Or: app.tsx loader's ensureMerchantConfig sync will refresh on next admin page load

Document this in the handback. Existing dev store will need one /app/config save to pick up "Aria".

## 5. Acceptance Checklist

### Visual elevation
- [ ] Header has avatar circle with sparkle icon
- [ ] Header has green status dot bottom-right of avatar
- [ ] Header shows agent name (Aria) on line 1, "Your shopping assistant" subtitle on line 2
- [ ] Welcome message bubble has new mode-aware copy
- [ ] Welcome state shows "SUGGESTED" label above chips
- [ ] Welcome chips use mode-aware copy (FASHION different from ELECTRONICS, etc.)
- [ ] Product cards show "AI Pick" badge top-left
- [ ] Product cards have larger images (240-280px)
- [ ] Product cards have "Add to Cart" + "View Details ↗" buttons stacked vertically
- [ ] Cards row has "X MATCHES" + "See all" header
- [ ] OOS cards show "Out of Stock" text on the disabled button
- [ ] Footer disclaimer "AI may make mistakes. Verify important details." appears below input
- [ ] Input bar has image icon (left), placeholder "Ask anything...", mic icon (right of text), up-arrow send button
- [ ] Image and mic icons are decorative (clicking shows "coming soon" toast)
- [ ] Send button is up-arrow style (↑), not paper plane

### Edge cases
- [ ] Empty state appears when search returns 0 products
- [ ] Empty state has "Browse all products" link to `/collections/all`
- [ ] Network error shows toast + ⚠ icon on failed message
- [ ] Card with no image shows clean placeholder (refined from Phase 2)
- [ ] Card with price=0 shows "Price on request" (or hides price row)

### Naming
- [ ] Default agent name for FASHION/JEWELLERY is "Aria"
- [ ] Default agent name for other modes is "AI Assistant"
- [ ] Merchant override still works (test by setting chatAgentName to "Bob" → widget shows "Bob")
- [ ] PDP CTA shows "Ask Aria" by default for FASHION/JEWELLERY

### Mobile responsiveness
- [ ] Chat panel goes full-screen on mobile viewport (<640px)
- [ ] Cards become full-width on mobile, stack vertically
- [ ] Header avatar/status/name layout works on narrow screens
- [ ] Input bar icons are tap-friendly (min 36×36 tap target)
- [ ] Suggestion chips wrap correctly on narrow screens

## 6. Files to Modify

```
extensions/storefront-widget/assets/chat-widget.js   ~+250 LOC (visual elevation)
extensions/storefront-widget/blocks/ask-ai-stylist.liquid  (PDP CTA redesign)
app/lib/merchant-config.ts                            (Aria default name)
app/lib/chat/prompts.server.ts                       (mode-aware welcome message)
app/lib/chat/suggestions.server.ts                   (mode-aware welcome chips)
```

No new files. Phase 3 is pure refinement of existing files.

## 7. Risk Areas

- **Bundle size growth.** Phase 2 hit 38KB raw / 10KB gzipped. Phase 3 adds ~250 more LOC. Estimate: 45-50KB raw / 12-13KB gzipped. Still well within practical limits but worth monitoring.
- **Theme conflicts on visual elements.** New header layout (avatar + status dot) uses pseudo-elements and absolute positioning. Some themes might have aggressive resets. Shadow DOM should isolate, but we'll verify.
- **OOS button text change visibility.** Some themes might override button text via CSS. Use textContent (already standard) and inline styles where critical.
- **Mobile keyboard interaction.** When mobile keyboard opens, the input might get covered. Test on real iPhone/Android. Existing 100dvh handling should cover this.
- **Aria name trademark.** Quick verification needed before any actual production launch (not v1 / dev). Many AI assistants use this name; could be conflict. For now, "Aria" is fine; merchants can override anyway.
- **Welcome chip copy localization.** All chip text is in English. International merchants will want translation. Defer to v2 (i18n is its own scope).

## 8. Out of Scope

- Image upload functionality (icon is decorative)
- Mic input functionality (icon is decorative)  
- Voice output (TTS)
- "See all" search page integration (just links to /search?q= for now)
- Size pills functional (just for v1 it would just show, not allow variant selection)
- Conversation history persistence
- Multi-language support
- Dark mode
- Custom themes per merchant beyond primary color
- Animation refinements (current Phase 1+2 animations are sufficient)
- A/B testing infrastructure
- Customer authentication / account linking

## 9. Demo Story After Phase 3 Ships

Customer visits storefront, sees subtle pulse on chat bubble. Clicks bubble — panel opens with spring animation. Header shows: avatar with sparkle, "Aria" name, "Your shopping assistant" subtitle, green online dot.

Welcome message: "Hi, I'm Aria from Aurea. How can I help you find your next favorite piece?" Below: "SUGGESTED" label and 4 chips: "Find me something under ₹3000", "Help me choose size", "Show me best sellers", "Create a complete look".

User taps "Find me something under ₹3000". Message sends, typing indicator. After ~2-3 seconds, Aria responds: "Based on what you're looking for, here are a few I'd recommend:" Below: "4 MATCHES — See all". Then 4 product cards with AI Pick badges, large images, prices, Add to Cart + View Details buttons.

User clicks Add to Cart on a kurta. Button shows "Adding...", toast appears: "Added to cart". Cart icon in header updates.

User scrolls down. Sees footer: "AI may make mistakes. Verify important details."

This is a complete, polished, visually distinct AI shopping assistant experience. The kind you can confidently demo to a customer, an investor, or post on Twitter.

---

*Phase 3 is the difference between "we built an AI feature" and "we built a product."*
