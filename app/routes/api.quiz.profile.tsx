// GET /api/quiz/profile — read-only profile lookup.
//
// Query: ?sessionId=...&shopDomain=...&storeMode=...
// Response: { profile: QuizProfile | null, state: QuizState | null }
//
// Used by the widget on open to know whether the user has a completed or
// skipped quiz (drives "Continue style profile" chip vs "Find my perfect
// style" chip per spec §4.6).

import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { STORE_MODES } from "../lib/merchant-config";
import {
  authorizePublicRequest,
  preflightResponse,
  corsHeaders,
} from "../lib/chat/public-route.server";
import { getQuizProfile, getSession } from "../lib/quiz/engine.server";

const QuerySchema = z.object({
  sessionId: z.string().min(8).max(128),
  shopDomain: z.string().min(3).max(255),
  storeMode: z.enum(STORE_MODES),
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const pre = preflightResponse(request);
  if (pre) return pre;

  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: corsHeaders(request.headers.get("origin")) },
    );
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    sessionId: url.searchParams.get("sessionId"),
    shopDomain: url.searchParams.get("shopDomain"),
    storeMode: url.searchParams.get("storeMode"),
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_query", detail: parsed.error.flatten() },
      { status: 400, headers: corsHeaders(request.headers.get("origin")) },
    );
  }
  const { sessionId, shopDomain, storeMode } = parsed.data;

  const auth = await authorizePublicRequest({ request, shopDomain, sessionId });
  if (!auth.ok) return auth.response;

  const session = await getSession({ shopDomain, sessionId, storeMode });
  const profile = await getQuizProfile({ shopDomain, sessionId, storeMode });

  return Response.json(
    {
      profile,
      state: session?.state ?? null,
      currentQuestionKey: session?.currentQuestionKey ?? null,
    },
    { status: 200, headers: auth.headers },
  );
};
