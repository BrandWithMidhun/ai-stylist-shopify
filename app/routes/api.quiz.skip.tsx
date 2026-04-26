// POST /api/quiz/skip — terminate quiz as SKIPPED. Partial profile is
// preserved (existing answers stay in QuizAnswer).
//
// Also serves /api/quiz/reset semantics via { mode: "reset" } in the body —
// "Edit my answers" goes through here to wipe answers and re-NOT_STARTED
// the session before the next /start call.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { STORE_MODES } from "../lib/merchant-config";
import {
  authorizePublicRequest,
  preflightResponse,
  corsHeaders,
} from "../lib/chat/public-route.server";
import { markSkipped, resetSession } from "../lib/quiz/engine.server";

const RequestBodySchema = z.object({
  sessionId: z.string().min(8).max(128),
  shopDomain: z.string().min(3).max(255),
  storeMode: z.enum(STORE_MODES),
  mode: z.enum(["skip", "reset"]).default("skip"),
});

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
  const { sessionId, shopDomain, storeMode, mode } = parsed.data;

  const auth = await authorizePublicRequest({ request, shopDomain, sessionId });
  if (!auth.ok) return auth.response;

  const session =
    mode === "reset"
      ? await resetSession({ shopDomain, sessionId, storeMode })
      : await markSkipped({ shopDomain, sessionId, storeMode });

  return Response.json(
    { ok: true, state: session.state },
    { status: 200, headers: auth.headers },
  );
};
