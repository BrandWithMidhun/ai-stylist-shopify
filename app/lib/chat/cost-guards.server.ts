// Cost guards for the chat agent.
//
// Layers on top of rate-limiter.server.ts (which is per-IP / per-session
// frequency-based, abuse-focused). These guards are cost-focused:
//   - Per-shop daily request cap — protects against runaway Anthropic spend
//     on one merchant.
//   - Per-message char cap — silently truncates oversized inputs so we don't
//     send massive prompts to Claude.
//
// v1 LIMITATION: in-memory Maps. Does not survive container restart and does
// not coordinate across Railway replicas (same caveat as rate-limiter.server.ts).
// Acceptable for v1 traffic. v2 will move to Redis.

const SHOP_DAILY_LIMIT = 1000;
const SHOP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

// Char cap is a proxy for token cap (~4 chars / token, conservative).
// Anything above this is silently truncated before being sent to Claude.
export const INPUT_CHAR_CAP = 4000;

type Bucket = { count: number; resetAt: number };

const shopBuckets = new Map<string, Bucket>();

export class RateLimitError extends Error {
  readonly kind: "shop_cap" | "session_cap";
  constructor(kind: "shop_cap" | "session_cap", message: string) {
    super(message);
    this.kind = kind;
    this.name = "RateLimitError";
  }
}

// Lazy cleanup so the map doesn't grow unbounded.
let lastCleanup = 0;
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < SHOP_WINDOW_MS) return;
  lastCleanup = now;
  for (const [k, v] of shopBuckets) {
    if (v.resetAt <= now) shopBuckets.delete(k);
  }
}

export type AssertResult = {
  // Possibly-truncated input text the caller should use instead of the original.
  text: string;
  truncated: boolean;
};

export function assertWithinLimits(
  shopDomain: string,
  _sessionId: string,
  inputText: string,
): AssertResult {
  maybeCleanup();

  // Per-shop daily cap. Throws on exceed; caller maps to HTTP 503.
  const now = Date.now();
  const existing = shopBuckets.get(shopDomain);
  if (!existing || existing.resetAt <= now) {
    shopBuckets.set(shopDomain, { count: 1, resetAt: now + SHOP_WINDOW_MS });
  } else {
    if (existing.count >= SHOP_DAILY_LIMIT) {
      throw new RateLimitError(
        "shop_cap",
        "AI capacity exceeded for today. Please try again tomorrow.",
      );
    }
    existing.count += 1;
  }

  // Char cap — silent truncation.
  const safe = inputText.length > INPUT_CHAR_CAP
    ? inputText.slice(0, INPUT_CHAR_CAP)
    : inputText;

  return {
    text: safe,
    truncated: safe.length !== inputText.length,
  };
}
