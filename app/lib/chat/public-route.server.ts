// Shared scaffolding for public storefront-origin endpoints.
//
// Originally extracted in 011a so /api/chat/message and the four /api/quiz/*
// routes share a single CORS, origin-check, shop-installed-check, and
// rate-limit pattern. Adding a new public endpoint should mean importing
// these helpers, not copy-pasting 30 lines per route.
//
// SECURITY NOTE: every public endpoint MUST validate shopDomain against an
// installed Session row. SessionId from the cookie is NOT identity proof —
// it's a per-browser correlation key, scoped within (shopDomain, sessionId).
// Any DB lookup keyed on sessionId must also filter on shopDomain.

import { isShopInstalled } from "./session.server";
import { checkRateLimits, getClientIp } from "./rate-limiter.server";

const ORIGIN_REGEX = /^https:\/\/[\w-]+\.myshopify\.com$/;

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ORIGIN_REGEX.test(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function isAllowedOrigin(origin: string | null): boolean {
  // No Origin header (server-side / curl): allowed; rate limit + shopDomain
  // checks downstream still apply. Cross-origin requests must match the
  // myshopify.com pattern.
  return !origin || ORIGIN_REGEX.test(origin);
}

// Handles OPTIONS preflight uniformly. React Router 7 dispatches OPTIONS
// to the route loader.
export function preflightResponse(request: Request): Response | null {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  return null;
}

// Composite gate: validates origin, looks up installed shop, applies rate
// limits. Returns either an authorized request payload or a Response to
// short-circuit with.
export async function authorizePublicRequest(input: {
  request: Request;
  shopDomain: string;
  sessionId: string;
}): Promise<
  | { ok: true; headers: Record<string, string> }
  | { ok: false; response: Response }
> {
  const origin = input.request.headers.get("origin");
  const headers = corsHeaders(origin);

  if (origin && !ORIGIN_REGEX.test(origin)) {
    return {
      ok: false,
      response: Response.json(
        { error: "forbidden_origin" },
        { status: 403, headers },
      ),
    };
  }

  const installed = await isShopInstalled(input.shopDomain);
  if (!installed) {
    return {
      ok: false,
      response: Response.json(
        { error: "shop_not_installed" },
        { status: 401, headers },
      ),
    };
  }

  const ip = getClientIp(input.request);
  const limit = checkRateLimits({ ip, sessionId: input.sessionId });
  if (!limit.ok) {
    return {
      ok: false,
      response: Response.json(
        { error: "rate_limited", reason: limit.reason },
        { status: 429, headers },
      ),
    };
  }

  return { ok: true, headers };
}
