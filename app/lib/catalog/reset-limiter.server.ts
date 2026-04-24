// In-memory rate limiter for the destructive Reset tags endpoint.
// 1 reset per shop per 60 seconds. Separate from the sync/batch limiter
// because reset is not a "job" — it's a single synchronous mutation.

const LAST_RESET_BY_SHOP = new Map<string, Date>();
const RESET_WINDOW_MS = 60 * 1000;

export type ResetRateLimitCheck =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function checkResetRateLimit(shopDomain: string): ResetRateLimitCheck {
  const last = LAST_RESET_BY_SHOP.get(shopDomain);
  if (!last) return { ok: true };
  const elapsed = Date.now() - last.getTime();
  if (elapsed >= RESET_WINDOW_MS) return { ok: true };
  return {
    ok: false,
    retryAfterSeconds: Math.ceil((RESET_WINDOW_MS - elapsed) / 1000),
  };
}

export function markResetCompleted(shopDomain: string): void {
  LAST_RESET_BY_SHOP.set(shopDomain, new Date());
}
