// In-memory token-bucket-ish rate limiter for the public chat endpoint.
//
// v1 LIMITATION: in-memory rate limiter does not survive container restart
// and does not coordinate across Railway replicas. Acceptable for v1 traffic.
// v2: move to Redis-backed limiter when we scale beyond single replica.

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const IP_LIMIT = 30; // 30 req / minute per IP
const SESSION_LIMIT = 60; // 60 req / minute per sessionId

const ipBuckets = new Map<string, Bucket>();
const sessionBuckets = new Map<string, Bucket>();

function check(map: Map<string, Bucket>, key: string, limit: number): boolean {
  const now = Date.now();
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

// Lazy cleanup so the maps don't grow unbounded under sustained traffic.
// Runs at most once per minute per call site.
let lastCleanup = 0;
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup < WINDOW_MS) return;
  lastCleanup = now;
  for (const [k, v] of ipBuckets) if (v.resetAt <= now) ipBuckets.delete(k);
  for (const [k, v] of sessionBuckets) if (v.resetAt <= now) sessionBuckets.delete(k);
}

export function checkRateLimits(input: {
  ip: string;
  sessionId: string;
}): { ok: true } | { ok: false; reason: "ip" | "session" } {
  maybeCleanup();
  if (!check(ipBuckets, input.ip, IP_LIMIT)) return { ok: false, reason: "ip" };
  if (!check(sessionBuckets, input.sessionId, SESSION_LIMIT)) {
    return { ok: false, reason: "session" };
  }
  return { ok: true };
}

export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
