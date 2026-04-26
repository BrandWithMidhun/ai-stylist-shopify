# Feature 011a — Onboarding Quiz Runtime + Gradient Color + Mobile Grid

**Status:** Draft
**Depends on:** 008 (chat widget shell + agent + product cards + Aria visual identity)
**Blocks:** 010 (stylist agent — uses profile data), 011b (admin CRUD UI for quiz)
**Owner:** Midhun
**Estimated effort:** 6-8 hours

---

## 1. Why

008 shipped a shopping assistant. The next leverage point is **personalization** — the assistant should know who the buyer is and what they like.

011a captures buyer preferences via an onboarding quiz that runs inside the existing chat widget. Profile data persists per-session (anonymous), feeds into the stylist agent (010) when that ships.

Two visual upgrades bundled in:
- **Gradient color support** — merchant primary color can be a 2-stop linear gradient (e.g., indigo → purple), not just a solid hex
- **Mobile grid for product cards** — replace Phase 3's horizontal scroll with consistent grid on all viewports

These bundle naturally because they're all visual/runtime layer work in the widget. Ships as one coherent merchant-facing improvement.

011b will follow with admin CRUD UI for managing quiz questions. For 011a, questions are hardcoded per storeMode in TypeScript (good defaults out of the box).

## 2. Goals & Non-Goals

### Goals
- Onboarding quiz UI inside chat widget — entry, progress bar, question rendering, answer capture, completion
- Hardcoded question trees per storeMode (FASHION, JEWELLERY, ELECTRONICS, FURNITURE, BEAUTY, GENERAL)
- Branching support: answer to Q1 changes which question is Q2 (e.g., gender → fit vs body type)
- AI augmentation: optional follow-up clarifying questions when answer is ambiguous (uses Sonnet 4.5)
- Profile persists per anonymous session UUID (cookie-based)
- Profile available to backend for downstream features (stylist agent will read it)
- Two entry points: chat bubble welcome state chip + auto-suggest after first message
- Gradient primary color: 2-stop linear with angle, configurable in /app/config
- Product cards grid layout on mobile + desktop (replaces horizontal scroll)
- Skip-able at any time, partial profile saved
- Industry-neutral copy across modes (FASHION asks fashion-y questions, ELECTRONICS asks tech-y questions)

### Non-Goals (deferred)
- Admin CRUD UI to edit questions/answers — 011b
- Multi-stop or radial gradients — defer
- Account linking / email capture — defer
- Quiz analytics dashboard (drop-off rate, completion) — defer
- A/B testing of question variations — defer
- Inline profiling (AI asking single profile questions during normal chat) — part of 010 stylist agent
- Stylist agent consumption of profile data — 010
- Quiz across multiple sessions (resume from where you left off after browser close) — defer
- Question logic beyond simple branching (e.g., adaptive difficulty, score-based pathways) — defer
- Image-based questions ("which of these styles do you like?") — defer to v2 with image upload feature
- Multi-language quiz translations — defer

## 3. Architecture

### 3.1 Quiz state machine

The quiz is a **finite state machine** with these states:

```
NOT_STARTED → IN_PROGRESS → COMPLETED
              ↓                  ↑
              SKIPPED ───────────┘
```

State transitions:
- User clicks "Start style quiz" chip OR `_startQuiz()` is called → NOT_STARTED → IN_PROGRESS
- Each answer advances to next question OR completion
- User clicks "Skip for now" → IN_PROGRESS → SKIPPED (persist partial profile)
- Last question answered → IN_PROGRESS → COMPLETED (persist full profile)

State persists in:
- Backend: `QuizSession` table keyed by anonymous session UUID
- Widget: in-memory mirror of state for rendering

### 3.2 Schema additions

```prisma
model QuizSession {
  id              String   @id @default(cuid())
  shopDomain      String
  sessionId       String   // anonymous UUID from widget cookie
  storeMode       StoreMode
  state           QuizState @default(NOT_STARTED)
  startedAt       DateTime?
  completedAt     DateTime?
  currentQuestionKey String? // which question is the user on
  answers         QuizAnswer[]
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([shopDomain, sessionId])
  @@unique([shopDomain, sessionId, storeMode])
}

model QuizAnswer {
  id           String   @id @default(cuid())
  sessionId    String   // FK to QuizSession.id
  questionKey  String   // e.g. "gender", "fit_preference"
  answerKey    String   // single-select answer key
  answerKeys   String[] // for multi-select
  answeredAt   DateTime @default(now())
  
  session      QuizSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  
  @@unique([sessionId, questionKey])
}

enum QuizState {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
  SKIPPED
}
```

### 3.3 Question tree definition (hardcoded, per storeMode)

In `app/lib/quiz/trees/<mode>.ts`:

```ts
export type QuizQuestion = {
  key: string;                          // unique within tree
  text: string;                         // shown to user
  helpText?: string;                    // optional subtitle
  type: 'single_select' | 'multi_select';
  options: QuizOption[];
  next: NextRule[];                     // branching rules
  required?: boolean;                   // default true; if false can skip individual question
};

export type QuizOption = {
  key: string;
  label: string;
  emoji?: string;                       // optional visual aid
};

export type NextRule =
  | { whenAnswerKey: string; goTo: string }  // if user picked X, next is Y
  | { default: true; goTo: string }          // fallback path
  | { complete: true };                       // end quiz
```

Example FASHION tree (excerpt):

```ts
[
  {
    key: 'gender',
    text: 'Who are you shopping for?',
    type: 'single_select',
    options: [
      { key: 'male', label: 'Men' },
      { key: 'female', label: 'Women' },
      { key: 'unisex', label: 'Both' },
      { key: 'kids', label: 'Kids' }
    ],
    next: [
      { whenAnswerKey: 'male', goTo: 'age_male' },
      { whenAnswerKey: 'female', goTo: 'age_female' },
      { whenAnswerKey: 'kids', goTo: 'age_kids' },
      { default: true, goTo: 'age_male' }
    ]
  },
  {
    key: 'age_male',
    text: 'What\'s your age range?',
    type: 'single_select',
    options: [
      { key: 'teen', label: 'Under 20' },
      { key: 'young_adult', label: '20-30' },
      { key: 'adult', label: '30-45' },
      { key: 'senior', label: '45+' }
    ],
    next: [{ default: true, goTo: 'fit_male' }]
  },
  // ... more questions
]
```

Each storeMode has its own tree file. Trees define their own question keys and branching.

### 3.4 Profile derivation

After quiz completes (or skips), backend derives a clean profile from QuizAnswer rows:

```ts
type QuizProfile = {
  storeMode: StoreMode;
  completed: boolean;
  // Mode-specific extracted data
  gender?: 'male' | 'female' | 'unisex' | 'kids';
  ageRange?: string;
  bodyType?: string;
  fitPreference?: string;
  styleVibe?: string;
  occasions?: string[];
  budget?: { min: number; max: number };
  colorPreferences?: string[];
  // ... etc per mode
};
```

This profile is what the stylist agent (010) will read to personalize recommendations.

### 3.5 AI follow-up questions (optional, lightweight)

Spec §1 mentions: "AI can ask questions for better screening."

Implementation: after structured quiz completes, ONE optional AI-generated follow-up question can fire to fill gaps. Logic:

1. Quiz completes with structured answers
2. Backend calls Sonnet 4.5 with: "Based on these answers: {answers}, ask ONE clarifying question that would help refine recommendations. Return JSON: { question: string, options: string[] }. Or return null if no clarification needed."
3. If non-null: render as the final quiz question (free-form, no branching)
4. Answer captured and saved as a special "ai_followup" answer in QuizAnswer

This adds intelligence without complicating the structured tree. AI is the cherry on top, not the main course.

For 011a: ship without AI follow-up. Add as a Phase 2 enhancement of 011a if simple. Keeps the build clean.

### 3.6 Quiz UI states inside widget

Widget gains a new mode state. Mode transitions:

```
WelcomeMode (default) ──[click "Start quiz"]──> QuizMode (IN_PROGRESS)
                       \
                        \─[normal chat]──> ChatMode

QuizMode ──[complete]──> ChatMode (with profile context)
QuizMode ──[skip]──> ChatMode (with partial profile)
```

The widget already tracks `messages` array. Quiz mode adds:
- `quizState: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'`
- `currentQuestionKey: string`
- `quizAnswers: Map<questionKey, answerKey | answerKeys>`
- `quizProgress: { current: number, total: number }`

The progress bar uses `current/total` for the percentage. Total is derived from the tree's longest path or hardcoded per tree.

### 3.7 Why progress bar with branching

User concern: progress bar is hard with branching since the path length varies.

Solution: each tree declares its `expectedQuestionCount` (the typical/average path length, e.g., 6 for FASHION). Progress bar shows `(current question index + 1) / expectedQuestionCount`. If a branch is shorter, the bar fills faster. If longer, it caps at 95% until the actual completion. Imperfect but reads naturally to users.

Alternative: show "Question N" without a percentage. Simpler. Pick one in implementation.

**Decision: show progress bar with `currentIndex / expectedQuestionCount`.** Accept that branching causes minor inaccuracy. Users don't audit progress bar math.

## 4. Visual Design (per Maison Lumière reference + your direction)

### 4.1 Quiz entry — welcome chip

In welcome state, ONE of the 4 chips is the quiz entry. Mode-aware label:
- FASHION/JEWELLERY: "Find my perfect style" (with sparkle icon)
- ELECTRONICS: "Help me find the right device"
- FURNITURE: "Find my perfect piece"
- BEAUTY: "Build my routine"
- GENERAL: "Help me get personalized recs"

Visual: same as other chips but with a small ⚡ or ✨ icon prefix to indicate "this opens the quiz."

Existing chips remain (e.g., "Find me something under ₹3000") — quiz is one of them, not replacing them.

### 4.2 Quiz mode UI

```
┌─────────────────────────────────────────────┐
│  ⊙[avatar] Aria              minimize  ✕   │
│            Your shopping assistant          │
├─────────────────────────────────────────────┤
│  Style profile · 2 of 6                     │
│  ████████░░░░░░░░░░░░░░░░ (33%)             │
├─────────────────────────────────────────────┤
│                                             │
│  Who are you shopping for?                  │
│                                             │
│  ┌─────────────┐  ┌─────────────┐           │
│  │   Men       │  │   Women     │           │
│  └─────────────┘  └─────────────┘           │
│  ┌─────────────┐  ┌─────────────┐           │
│  │   Both      │  │   Kids      │           │
│  └─────────────┘  └─────────────┘           │
│                                             │
│                                             │
│        [Skip for now]                       │
│                                             │
└─────────────────────────────────────────────┘
```

**Components:**

- **Header**: same as chat mode (avatar + name + subtitle + close)
- **Quiz progress bar section**: 
  - Label "Style profile · {current} of {total}" (12px, semi-bold)
  - Progress bar: 4px height, rounded, primary color fill on light gray track, padding around
- **Question text**: 18-20px, semi-bold, padding 24px 20px 16px
- **Options grid**: 2-column on desktop AND mobile (consistent), 12px gap
- **Option button**:
  - Width: 50% minus gap
  - Height: ~56px
  - Background: white
  - Border: 1.5px solid #E4E4E7
  - Border-radius: 12px
  - Text: centered, 14px, medium weight
  - Hover (desktop): border becomes primary color
  - Active/selected (single-select): primary color background, white text
  - For multi-select: shows checkmark icon when selected
  - Optional emoji prefix in label
- **Skip link**: bottom of panel, "Skip for now" 13px text, muted color, centered, padding 16px

**Mobile responsive:**
- Same 2-column grid layout (this is your specific request)
- Tighter padding (16px instead of 20-24px)
- Slightly smaller question text (16px)

### 4.3 Multi-select question

For questions like "What occasions do you shop for?":
- Same grid layout
- Tap toggles selection (checkmark appears)
- "Continue" button appears at bottom when at least one is selected
- "Skip" still available

### 4.4 Completion screen

When quiz finishes:

```
┌─────────────────────────────────────────────┐
│  [Header]                                   │
├─────────────────────────────────────────────┤
│                                             │
│         🎯 (or ✨ icon, 48px)               │
│                                             │
│   Profile complete                          │
│                                             │
│   I've learned your style. Let me find      │
│   you something perfect.                    │
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │   See my recommendations              │ │
│  └────────────────────────────────────────┘ │
│                                             │
│         [Edit my answers]                   │
│                                             │
└─────────────────────────────────────────────┘
```

**Components:**
- Icon: 48px primary color or gradient
- Heading: 20px, semi-bold
- Subtitle: 14px, color #666
- "See my recommendations" CTA: full-width primary button (uses gradient if configured)
- "Edit my answers" link: secondary, opens quiz at first question

**On clicking "See my recommendations"**:
- Quiz mode exits
- Chat mode resumes
- AI auto-sends a personalized greeting using profile context: "Based on your style, here are some pieces I think you'll love:" followed by an actual product search filtered by profile
- This requires the quiz profile to be passed as context to the agent — the agent_input gains a `quizProfile` field

### 4.5 Skip behavior

When user clicks "Skip for now":
- Quiz state → SKIPPED
- Partial profile persists (only answered questions saved)
- Widget returns to chat mode
- Friendly message: "No problem — I'll remember what you've told me so far. Let me know if you want to continue."
- The quiz entry chip is still available; clicking it offers to continue from where they left off

### 4.6 Resume behavior

If user re-opens widget after skip:
- If quizState === SKIPPED: welcome state shows extra chip "Continue style profile" alongside the others
- Clicking it resumes from `currentQuestionKey`
- If quizState === COMPLETED: no quiz chip needed; profile is set

For 011a session-cookie-only: resume only works within the same browser session. New browser session = quiz starts fresh.

## 5. Mode-Specific Question Trees

For 011a, hardcode these in `app/lib/quiz/trees/`. Admin CRUD UI in 011b.

### 5.1 FASHION (8 questions, branching)

1. Gender (Men/Women/Both/Kids) → branches age + fit/body
2. Age range (Under 20 / 20-30 / 30-45 / 45+)
3. Body type (women only) OR fit preference (men) — slim/regular/relaxed
4. Lifestyle (work-focused / casual / mixed / festive-heavy)
5. Style vibe (multi-select): minimalist, traditional, contemporary, statement, sporty, vintage
6. Occasions you shop for (multi-select): daily wear, work, festive, party, sport, travel
7. Color preferences (multi-select): neutrals, earth tones, jewel tones, pastels, brights, monochrome
8. Budget tier: budget (under ₹2000), mid-range (₹2000-5000), premium (₹5000-10000), luxury (₹10000+)

### 5.2 JEWELLERY (6 questions)

1. Who are you shopping for (Self / Spouse / Family / Gift)
2. Occasion (Daily / Festive / Bridal / Gift / Religious)
3. Metal preference (Gold / Silver / Platinum / Mixed / No preference)
4. Style (Traditional / Contemporary / Minimalist / Statement)
5. Budget tier (under ₹10k / ₹10-50k / ₹50k-1L / ₹1L+ / "fine jewellery")
6. Gemstone interest (multi-select): diamond, ruby, emerald, sapphire, pearl, none, "show me anything"

### 5.3 ELECTRONICS (6 questions)

1. Use case (Work / Gaming / Student / Creator / Casual)
2. Platform preference (Apple / Android / Windows / Cross-platform / No preference)
3. Skill level (Beginner / Intermediate / Expert)
4. What are you looking for (multi-select): laptop, phone, audio, smart home, wearable, accessories
5. Budget tier (Budget / Mid-range / Premium / Pro)
6. Brand loyalty (Strict — only certain brands / Open / No preference)

### 5.4 FURNITURE (6 questions)

1. Room (Living / Bedroom / Dining / Office / Outdoor / Whole house)
2. Space size (Small / Medium / Large / Open plan)
3. Style (Modern / Rustic / Industrial / Traditional / Mixed)
4. Move/permanent (Renting & moving soon / Permanent / Mixed)
5. Budget tier (under ₹20k / ₹20-50k / ₹50k-1L / ₹1L+)
6. What are you furnishing (multi-select): sofas, beds, tables, storage, decor, lighting

### 5.5 BEAUTY (6 questions)

1. Skin/hair type (multi-select): oily, dry, combination, sensitive, normal, frizzy, fine, etc.
2. Concerns (multi-select): anti-aging, acne, hydration, brightening, sensitivity, scalp care
3. Routine complexity (Minimal / Moderate / Extensive)
4. Ingredient preferences (multi-select): vegan, cruelty-free, fragrance-free, all-natural, no preference
5. Budget tier
6. Categories (multi-select): skincare, makeup, haircare, fragrance, body care

### 5.6 GENERAL (3 questions)

1. What are you looking for today (free-text or chips: gift, treat for myself, replacement, exploring)
2. Budget tier
3. Anything specific (free-text optional)

## 6. Gradient Color Support

### 6.1 Schema additions

```prisma
model MerchantConfig {
  // ... existing
  chatPrimaryColor       String  @default("#000000")
  chatPrimaryColorEnd    String? // gradient end color (null = solid color)
  chatPrimaryGradientAngle Int    @default(135) // degrees, 0-360
}
```

When `chatPrimaryColorEnd` is null: solid color (current behavior).
When set: linear gradient from `chatPrimaryColor` (start) to `chatPrimaryColorEnd` (end) at the specified angle.

### 6.2 /app/config UI

Replace the single color field with:

```
Primary color
[Color picker: #4F46E5]

Gradient (optional)
[Toggle: Enable gradient]
  When enabled:
    End color: [Color picker: #9333EA]
    Angle: [Slider 0-360°: 135°]
    [Live preview swatch showing the gradient]
```

When toggle off: no gradient, solid color (current behavior).

### 6.3 Metafield payload

Add to v3 metafield payload (bump version):

```json
{
  "primaryColor": "#4F46E5",
  "primaryColorEnd": "#9333EA",
  "primaryGradientAngle": 135,
  // ... other fields
}
```

If `primaryColorEnd` is null/missing, widget uses solid color.

### 6.4 Widget CSS — gradient application

CSS variable approach with a fallback:

```css
:host {
  --primary-color: #000;
  --primary-color-end: #000;
  --primary-gradient: var(--primary-color);  /* default to solid */
}

/* Set via JS at construction:
   if config.primaryColorEnd:
     :host { --primary-gradient: linear-gradient(135deg, var(--primary-color), var(--primary-color-end)) }
   else:
     :host { --primary-gradient: var(--primary-color); }
*/

.send-button { background: var(--primary-gradient); }
.user-message { background: var(--primary-gradient); }
.add-to-cart-button { background: var(--primary-gradient); }
.option-selected { background: var(--primary-gradient); }
.completion-cta { background: var(--primary-gradient); }
```

Where to apply gradient:
- Send button (bubble + arrow)
- User message bubble background  
- Add-to-Cart button
- Selected quiz option
- Quiz completion CTA
- Bubble icon background (closed state)

Where to NOT apply gradient (use solid primary or text color only):
- Avatar background (cleaner with solid)
- Border colors
- Small icons (legibility)
- Status dot (use green not primary)

### 6.5 Edge cases

- If start and end colors are equal: still renders as gradient (user explicitly chose, even though invisible)
- If end color is null/empty: solid color (current)
- Invalid hex: validation in /app/config rejects save with form error

## 7. Mobile Grid for Product Cards

### 7.1 Current state (Phase 3)

Mobile: horizontal scroll-snap, cards 80% width, swipe through.
Desktop: grid wrap, multiple rows.

### 7.2 New state (per your request)

**All viewports**: 2-column grid for product cards.

```css
.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

@media (min-width: 641px) {
  .cards {
    grid-template-columns: repeat(2, 1fr); /* desktop also 2-col within widget panel */
  }
}
```

Wait — desktop widget panel is ~380px wide. 2-column cards at ~170px each is reasonable. But the panel might stretch on tablets. Let me think:

**Better approach: container-query-style breakpoints**

```css
.cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

/* If widget panel is wider than 600px (e.g., tablet), allow 3-col */
@container (min-width: 600px) {
  .cards {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

Container queries are well-supported in 2026. If not preferred, just stick with 2-col everywhere. **Default: 2-col on all viewports** to match your spec.

### 7.3 Card sizing in grid

- Width: 50% of container minus gap
- Aspect ratio: 1:1 image, then content below
- Title: 13px (smaller than scroll version), 2-line ellipsis
- Price: 14px, bold
- Buttons: same vertical stack pattern but tighter (40px height instead of 48px)

### 7.4 Quantity considerations

If 6+ products returned, grid wraps to 3 rows on mobile. That's fine — user scrolls down within the message area. If 12 products returned, 6 rows. Acceptable.

If we ever need to limit display: render first 6, show "Show 6 more" button. **Defer to v2.** For 011a, render all returned products in grid.

## 8. Implementation Plan

### 8.1 Files to create

```
prisma/schema.prisma                    (additions: QuizSession, QuizAnswer, QuizState enum, gradient fields)
app/lib/quiz/types.ts                   (~80 LOC: types for QuizQuestion, QuizOption, etc.)
app/lib/quiz/trees/fashion.ts           (~140 LOC: FASHION question tree)
app/lib/quiz/trees/jewellery.ts         (~100 LOC)
app/lib/quiz/trees/electronics.ts       (~80 LOC)
app/lib/quiz/trees/furniture.ts         (~80 LOC)
app/lib/quiz/trees/beauty.ts            (~80 LOC)
app/lib/quiz/trees/general.ts           (~30 LOC)
app/lib/quiz/registry.ts                (~30 LOC: getTreeFor(storeMode))
app/lib/quiz/engine.server.ts           (~150 LOC: state machine, branching, profile derivation)
app/routes/api.quiz.start.tsx           (~40 LOC: POST initialize quiz, return Q1)
app/routes/api.quiz.answer.tsx          (~60 LOC: POST record answer, return next Q or completion)
app/routes/api.quiz.skip.tsx            (~30 LOC: POST mark skipped)
app/routes/api.quiz.profile.tsx         (~30 LOC: GET current profile by sessionId)
prisma/migrations/<timestamp>_add_quiz/migration.sql
```

### 8.2 Files to modify

```
extensions/storefront-widget/assets/chat-widget.js  (significant: quiz mode state, render paths, grid CSS for cards, gradient CSS variable wiring)
extensions/storefront-widget/blocks/chat-embed.liquid  (read gradient fields from metafield)
app/routes/app.config.tsx               (gradient toggle + end color + angle controls)
app/lib/merchant-config.server.ts       (zod for new gradient fields, getEffective helpers)
app/lib/chat/metafield-sync.server.ts   (v2 → v3 payload with gradient fields)
app/lib/chat/agent.server.ts            (accept quizProfile in input, use in system prompt as context)
app/lib/chat/prompts.server.ts          (system prompt extension when profile present)
```

### 8.3 Implementation order

1. Schema migrations (gradient fields + Quiz tables)
2. Quiz types + tree definitions for all 6 storeModes
3. Quiz engine (state machine, branching logic, profile derivation)
4. Backend API endpoints (start, answer, skip, profile)
5. Widget quiz mode (new state, render paths, progress bar, options grid, completion screen)
6. Widget grid layout for product cards (replace horizontal scroll)
7. Gradient color: schema + /app/config UI + metafield + widget CSS variable
8. Agent integration: pass quiz profile as context for personalized recs
9. Smoke test: take a quiz end-to-end, verify profile saves, verify it influences a follow-up search

Each step ends green: lint + typecheck + build.

## 9. Acceptance Checklist

### Quiz runtime
- [ ] Welcome state shows quiz entry chip ("Find my perfect style" or mode-equivalent)
- [ ] Clicking chip switches widget to quiz mode
- [ ] Q1 shows: progress bar, question text, options grid, skip link
- [ ] Tapping an option records answer, advances to next question
- [ ] Branching works: gender = "Women" goes to body type, gender = "Men" goes to fit
- [ ] Multi-select questions show "Continue" button when ≥1 selected
- [ ] Progress bar advances correctly (current/total)
- [ ] Skip link saves partial profile, returns to chat mode
- [ ] Last question completion → completion screen
- [ ] Completion screen "See recommendations" → exits quiz, AI sends personalized welcome
- [ ] Completion screen "Edit my answers" → restarts quiz at Q1
- [ ] Re-opening widget after skip shows "Continue style profile" chip
- [ ] Profile persists in QuizSession + QuizAnswer tables

### Mode-specific trees
- [ ] FASHION quiz works (8 questions with branching)
- [ ] JEWELLERY quiz works (6 questions)
- [ ] ELECTRONICS quiz works (6 questions)
- [ ] FURNITURE quiz works (6 questions)
- [ ] BEAUTY quiz works (6 questions)
- [ ] GENERAL quiz works (3 questions)

### Gradient color
- [ ] /app/config has gradient toggle
- [ ] When off: single color picker (current behavior)
- [ ] When on: end color picker + angle slider visible
- [ ] Live preview swatch shows the gradient
- [ ] Save persists gradient fields
- [ ] Metafield writes v3 payload with gradient
- [ ] Widget renders gradient on send button, user bubbles, Add to Cart, selected quiz options
- [ ] Solid-color elements stay solid (avatar bg, borders)
- [ ] Storefront updates after /app/config save + hard refresh

### Mobile grid
- [ ] Product cards render in 2-column grid on mobile
- [ ] Product cards render in 2-column grid on desktop
- [ ] Card sizing scales correctly within widget panel
- [ ] No horizontal scroll
- [ ] 6+ products wrap to multiple rows
- [ ] Mobile cards remain readable (title, price legible)

### Profile integration
- [ ] Completed quiz profile stored in QuizSession + QuizAnswer
- [ ] Agent reads quizProfile from session lookup on each /api/chat/message call
- [ ] System prompt includes profile context when profile is non-empty
- [ ] Personalized welcome after quiz completion uses profile to inform search

## 10. Risk Areas

- **Branching tree complexity.** Hardcoded trees have ~30-50 nodes each. Mistakes in `next` rules cause infinite loops or unreachable questions. Mitigation: trees are TS so typecheck catches obvious errors. Each tree has a `validateTree()` runtime check on first load.
- **Progress bar inaccuracy.** With branching, exact progress is unknowable. Use approximation per §3.7. Document as known limitation.
- **Quiz state and chat state coupling.** Widget runs in two modes inside one component. Mode switching at the wrong time could lose data. Mitigation: explicit mode state, all transitions go through `_setMode()` method.
- **Gradient browser support.** Linear gradients are universally supported. No risk.
- **Mobile grid + small viewports.** On <320px viewport (very rare), 2-column might be too cramped. Mitigation: minimum card width via `minmax`. Card title may truncate aggressively.
- **Profile fed to agent on every request.** Adds 50-200 tokens to system prompt per request. Cost impact: small but non-zero. Monitor in production.
- **Quiz incomplete + agent recommendations.** If user skips quiz mid-flow, agent gets partial profile. Some attributes will be missing. Agent must handle gracefully (no crash). Mitigation: profile fields are all optional in agent input.
- **Bundle size growth.** Quiz logic adds ~250-400 LOC to chat-widget.js. Phase 3 was 52KB raw / 13.4KB gzipped. Estimate after 011a: 65-75KB raw / 16-19KB gzipped. Approaching the practical limit. Worth keeping an eye on.
- **/app/config form size.** Adding gradient toggle + end color + angle adds another section. Form is getting long. Consider a dedicated "Appearance" sub-section in v2.

## 11. Out of Scope (deferred)

- Admin CRUD UI for editing quiz questions/answers — 011b
- Multi-stop or radial gradients
- Image-based quiz questions ("which look do you prefer?")
- AI follow-up question after structured quiz (mentioned as nice-to-have, deferred)
- Cross-session quiz resume (closing browser starts fresh quiz)
- Email/account capture at completion
- Quiz analytics dashboard
- A/B test variants
- Conversational quiz path (Option B from earlier — questions inline in chat) — that's part of 010
- Quiz-driven product collections ("see your style edit") — defer
- Lookbook generation from quiz answers — that's 014
- Multi-language support
- Auto-suggest quiz after first message — defer; v1 entry is welcome chip only

## 12. Demo Story After 011a Ships

Customer visits Maison Lumière (your brand inspired by the reference). Clicks chat bubble. Aria's welcome message + 4 chips: "Find me something under ₹3000", "Help me choose size", **"Find my perfect style ✨"**, "Show me best sellers".

Taps "Find my perfect style ✨". Widget transitions to quiz mode. Progress bar shows "Style profile · 1 of 6". Question: "Who are you shopping for?" with 4 options in a 2x2 grid. Tap "Women" → progress advances to "2 of 6", new question "What's your age range?" with 4 options.

Continues through 6 questions. Branches don't show — the user just sees a coherent flow tailored to their gender, lifestyle. Each question has a "Skip for now" link at the bottom.

After Q6, completion screen: 🎯 icon, "Profile complete", "I've learned your style. Let me find you something perfect."

Taps "See my recommendations". Widget exits quiz mode. Aria sends a personalized message: "Based on your style — minimalist, occasion-driven, pastel-friendly — here are some pieces I think you'll love:" Below: 4 product cards in a 2-column grid (consistent on all viewports). The cards are filtered to women's apparel matching the profile's style tags.

User clicks Add to Cart. Toast: "Added to cart" (with the new gradient background — indigo to purple).

User scrolls back up, asks "what about something more formal?" Aria already knows the user's age, occasions, budget — responds with personalized formal options without asking again.

This is a meaningfully personalized AI shopping assistant with a real onboarding flow. After 011a + 010 (stylist) ships, this becomes a competitive product, not a tech demo.

---

*011a is the bridge from "AI assistant that searches" to "AI assistant that knows you." The quiz is the data foundation; the gradient and grid are the visual polish that makes the experience feel premium.*
