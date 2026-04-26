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
  authorizePublicRequest,
  corsHeaders,
  preflightResponse,
} from "../lib/chat/public-route.server";

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

// In React Router 7, OPTIONS preflight requests dispatch to the route
// loader (POST/PUT/PATCH/DELETE go to the action). preflightResponse handles
// OPTIONS uniformly across public routes; non-OPTIONS GET falls through.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const pre = preflightResponse(request);
  if (pre) return pre;
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: corsHeaders(request.headers.get("origin")) },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: corsHeaders(request.headers.get("origin")) },
    );
  }

  const startTime = Date.now();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json" },
      { status: 400, headers: corsHeaders(request.headers.get("origin")) },
    );
  }

  const parsed = RequestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_body", detail: parsed.error.flatten() },
      { status: 400, headers: corsHeaders(request.headers.get("origin")) },
    );
  }
  const { sessionId, shopDomain, text, context, history } = parsed.data;

  const auth = await authorizePublicRequest({ request, shopDomain, sessionId });
  if (!auth.ok) return auth.response;
  const headers = auth.headers;

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
