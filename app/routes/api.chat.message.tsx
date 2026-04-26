// Public storefront chat endpoint — POST /api/chat/message.
//
// This is intentionally NOT behind shopify.authenticate.admin: the storefront
// widget is hit by anonymous customers. We guard against abuse with:
//   1. CORS — only allow Origin matching /^https:\/\/[\w-]+\.myshopify\.com$/
//   2. shopDomain validation — must match an installed Session row
//   3. Rate limit — 30 req/min per IP, 60 req/min per sessionId (in-memory)
//
// v1: hardcoded canned responses. v2 (008+): same endpoint routes through
// the agent orchestrator without any widget changes.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { runAgent } from "../lib/chat/agent.server";
import type { ProductContext } from "../lib/chat/canned-responses.server";
import { RateLimitError } from "../lib/chat/cost-guards.server";
import {
  checkRateLimits,
  getClientIp,
} from "../lib/chat/rate-limiter.server";
import { isShopInstalled } from "../lib/chat/session.server";

const ORIGIN_REGEX = /^https:\/\/[\w-]+\.myshopify\.com$/;
const MIN_RESPONSE_MS = 600; // typing indicator must feel real

const HistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
});

const ProductContextSchema = z
  .object({
    handle: z.string().max(255).optional(),
    title: z.string().max(500).optional(),
    imageUrl: z.string().max(2000).optional(),
    variantId: z.string().max(64).optional(),
  })
  .nullable()
  .optional();

const RequestBodySchema = z.object({
  sessionId: z.string().min(8).max(128),
  shopDomain: z.string().min(3).max(255),
  text: z.string().max(2000),
  context: ProductContextSchema,
  history: z.array(HistoryMessageSchema).max(20).default([]),
});

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && ORIGIN_REGEX.test(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

// In React Router 7, OPTIONS preflight requests dispatch to the route
// loader (POST/PUT/PATCH/DELETE go to the action). We return 204 + CORS
// headers from the loader to satisfy preflight.
//
// If a future RR upgrade short-circuits OPTIONS before reaching loaders,
// we'll need a server-level handler in entry.server.tsx — verified working
// in this version (RR7 ^7.12).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers });
  }

  // Reject cross-origin requests that don't match the storefront pattern
  // unless there's no Origin (server-side calls, curl). Public endpoint with
  // no Origin is fine — we still apply rate limit + shopDomain check.
  if (origin && !ORIGIN_REGEX.test(origin)) {
    return Response.json({ error: "forbidden_origin" }, { status: 403, headers });
  }

  const startTime = Date.now();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers });
  }

  const parsed = RequestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", detail: parsed.error.flatten() },
      { status: 400, headers },
    );
  }
  const { sessionId, shopDomain, text, context, history } = parsed.data;

  // shopDomain must belong to an installed shop. Prevents random external
  // clients from hitting the endpoint with arbitrary shop names.
  const installed = await isShopInstalled(shopDomain);
  if (!installed) {
    return Response.json({ error: "shop_not_installed" }, { status: 401, headers });
  }

  const ip = getClientIp(request);
  const limit = checkRateLimits({ ip, sessionId });
  if (!limit.ok) {
    return Response.json(
      { error: "rate_limited", reason: limit.reason },
      { status: 429, headers },
    );
  }

  const isFirstMessage = history.length === 0;

  let agentResult;
  try {
    agentResult = await runAgent({
      shopDomain,
      sessionId,
      text,
      context: (context ?? null) as ProductContext,
      history,
      isFirstMessage,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      const status = err.kind === "shop_cap" ? 503 : 429;
      return Response.json(
        { error: "rate_limited", reason: err.kind, message: err.message },
        { status, headers },
      );
    }
    throw err;
  }

  // Artificial floor so the typing indicator feels real for fast (no-tool)
  // responses. Tool-calling rounds typically run well above this floor; this
  // only kicks in for trivial small-talk replies.
  const elapsed = Date.now() - startTime;
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((r) => setTimeout(r, MIN_RESPONSE_MS - elapsed));
  }

  // Phase 1 response shape: extends 007 with a `products` array. Older
  // widgets ignore the field; Phase 2 widget renders cards from it.
  return Response.json(
    {
      message: {
        id: agentResult.message.id,
        role: agentResult.message.role,
        content: agentResult.message.content,
        timestamp: agentResult.message.timestamp,
        suggestions: agentResult.message.suggestions,
        products: agentResult.message.products,
        // 008 Phase 3: lets the widget distinguish "no tool call" (small
        // talk) from "tool ran but returned nothing" (empty state UI).
        // toolCalls is debug-only on the agent output, but this single flag
        // is part of the wire contract.
        searched: agentResult.debug.toolCalls > 0,
      },
    },
    { status: 200, headers },
  );
};
