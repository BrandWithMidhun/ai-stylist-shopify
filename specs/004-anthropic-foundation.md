# Feature 004: Anthropic API Foundation

## Purpose

Add server-side Anthropic Claude integration to the app so all future AI features (product tagging, stylist agent, chat widget, quiz) can share a single, tested LLM client.

## User-visible outcome

A new admin page at /app/ai-test with:
- A textarea for the user to enter a prompt
- A "Send to Claude" button
- A response area showing Claude reply
- Loading state while waiting
- Error state if the API call fails

This page is a development and test page, not a merchant-facing feature. It proves the plumbing works and gives us a surface to test prompts during development.

## Scope

### In scope

- Anthropic SDK wired up as a server-side singleton
- ANTHROPIC_API_KEY loaded from environment (local .env and Railway)
- One reusable helper callClaude(prompt, options) that the rest of the codebase can use
- Sensible defaults: Claude Sonnet 4.5, max_tokens 1024, temperature 0.7
- Basic error handling: return a typed error object, never throw unhandled
- Admin page with textarea, submit, response area, loading and error states
- Polaris web components for UI (s-page, s-section, s-text-area, s-button, s-text)
- Link in app nav so we can reach the page

### Explicitly out of scope (later features)

- Streaming responses
- Conversation history, multi-turn
- System prompt customization
- Per-merchant API key storage
- Rate limiting
- Token usage tracking or cost display
- Retries on transient failures (we will add this in Feature 005 when we need it for batch tagging)

## Architecture

### File layout

- app/lib/anthropic.server.ts: singleton client plus callClaude() helper. Server-only, never imported from client code.
- app/routes/app.ai-test.tsx: route for the admin page. Uses an action to call callClaude().

### The helper signature

type CallClaudeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

async function callClaude(
  prompt: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<CallClaudeResult>;

Returns { ok: true, text } on success. Returns { ok: false, error } with a user-safe error message on failure. Never throws.

Under the hood: the Anthropic SDK client is lazily created once per process and reused across requests.

### Environment variables

- ANTHROPIC_API_KEY: required. If missing, callClaude() returns { ok: false, error: "Anthropic API key not configured" }.
- Added to .env.example with a placeholder so developers know it is required.

### Admin page behavior

- Uses React Router 7 action plus useFetcher pattern (standard for the template).
- Form submits prompt to the action, which calls callClaude() and returns the result.
- UI renders either the response text or the error, based on ok.
- While submitting, button is disabled and shows a loading state.

## Model choice

Use the latest Claude Sonnet available (verify exact model string with Shopify Dev MCP or Anthropic docs at build time). Sonnet is the right default: fast enough for interactive admin pages, smart enough for tagging and styling tasks. Opus is reserved for Feature 005 and later where we might need deeper reasoning.

## Success criteria

1. Local shopify app dev:
   - Navigate to /app/ai-test in the embedded admin
   - Enter "Say hi in one sentence"
   - Click Send
   - See Claude response appear
2. Railway production:
   - Same flow works after deploying
3. Error path:
   - Temporarily misconfigure ANTHROPIC_API_KEY, submit prompt, see the configured error message (not a crash)

## Non-goals

- Beautiful UI. Functional is fine. Polaris default styling.
- Prompt engineering. We are not trying to get great outputs; we are testing plumbing.

## Dependencies

- Install @anthropic-ai/sdk as a runtime dep (not dev dep).
- Ensure ANTHROPIC_API_KEY is set locally in .env and in Railway Variables.
