// POST /api/quiz/start — begin (or resume) a quiz for an anonymous session.
//
// Request:  { sessionId, shopDomain, storeMode }
// Response: { question, expectedQuestionCount, currentIndex, total }
//
// Returns the question to render. If the session is COMPLETED, returns
// { complete: true } — caller should show the completion screen, not Q1.
// "Edit my answers" goes through /api/quiz/reset before /start.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { STORE_MODES } from "../lib/merchant-config";
import {
  authorizePublicRequest,
  preflightResponse,
  corsHeaders,
} from "../lib/chat/public-route.server";
import { startSession } from "../lib/quiz/engine.server";

const RequestBodySchema = z.object({
  sessionId: z.string().min(8).max(128),
  shopDomain: z.string().min(3).max(255),
  storeMode: z.enum(STORE_MODES),
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
  const { sessionId, shopDomain, storeMode } = parsed.data;

  const auth = await authorizePublicRequest({ request, shopDomain, sessionId });
  if (!auth.ok) return auth.response;

  const { session, question, tree } = await startSession({
    shopDomain,
    sessionId,
    storeMode,
  });

  if (session.state === "COMPLETED") {
    return Response.json(
      {
        complete: true,
        state: session.state,
        expectedQuestionCount: tree.expectedQuestionCount,
      },
      { status: 200, headers: auth.headers },
    );
  }

  return Response.json(
    {
      question: serializeQuestion(question),
      expectedQuestionCount: tree.expectedQuestionCount,
      currentIndex: indexOf(tree, question.key),
      total: tree.expectedQuestionCount,
      state: session.state,
    },
    { status: 200, headers: auth.headers },
  );
};

function indexOf(
  tree: { questions: { key: string }[] },
  key: string,
): number {
  return Math.max(
    0,
    tree.questions.findIndex((q) => q.key === key),
  );
}

function serializeQuestion(q: {
  key: string;
  text: string;
  helpText?: string;
  type: string;
  options: { key: string; label: string; emoji?: string }[];
  required?: boolean;
}) {
  return {
    key: q.key,
    text: q.text,
    helpText: q.helpText ?? null,
    type: q.type,
    options: q.options,
    required: q.required ?? true,
  };
}
