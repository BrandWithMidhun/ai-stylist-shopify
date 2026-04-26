// POST /api/quiz/answer — record an answer and return the next question or
// completion signal.
//
// Request:  { sessionId, shopDomain, storeMode, questionKey, answerKey?, answerKeys? }
// Response on next question: { question, currentIndex, total }
// Response on completion:    { complete: true, profile? }
//
// Validation:
//   - For single_select: answerKey required, must be a valid option key.
//   - For multi_select:  answerKeys required, all entries must be valid options.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { STORE_MODES } from "../lib/merchant-config";
import {
  authorizePublicRequest,
  preflightResponse,
  corsHeaders,
} from "../lib/chat/public-route.server";
import { recordAnswer, getQuizProfile } from "../lib/quiz/engine.server";
import { getTreeFor } from "../lib/quiz/registry";

const RequestBodySchema = z
  .object({
    sessionId: z.string().min(8).max(128),
    shopDomain: z.string().min(3).max(255),
    storeMode: z.enum(STORE_MODES),
    questionKey: z.string().min(1).max(64),
    answerKey: z.string().min(1).max(64).optional(),
    answerKeys: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .refine((d) => d.answerKey != null || (d.answerKeys != null && d.answerKeys.length > 0), {
    message: "answerKey or non-empty answerKeys is required",
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
  const { sessionId, shopDomain, storeMode, questionKey, answerKey, answerKeys } = parsed.data;

  const auth = await authorizePublicRequest({ request, shopDomain, sessionId });
  if (!auth.ok) return auth.response;

  // Validate that the question + answer keys belong to the tree. Stops a
  // malformed widget from poisoning the answer rows.
  const tree = getTreeFor(storeMode);
  const q = tree.questions.find((x) => x.key === questionKey);
  if (!q) {
    return Response.json(
      { error: "unknown_question" },
      { status: 400, headers: auth.headers },
    );
  }

  const validOptionKeys = new Set(q.options.map((o) => o.key));
  if (q.type === "single_select") {
    if (!answerKey || !validOptionKeys.has(answerKey)) {
      return Response.json(
        { error: "invalid_answer_key" },
        { status: 400, headers: auth.headers },
      );
    }
  } else {
    if (!answerKeys || answerKeys.length === 0) {
      return Response.json(
        { error: "answer_keys_required" },
        { status: 400, headers: auth.headers },
      );
    }
    for (const k of answerKeys) {
      if (!validOptionKeys.has(k)) {
        return Response.json(
          { error: "invalid_answer_key", detail: k },
          { status: 400, headers: auth.headers },
        );
      }
    }
  }

  const { step } = await recordAnswer({
    shopDomain,
    sessionId,
    storeMode,
    questionKey,
    answerKey: q.type === "single_select" ? answerKey : undefined,
    answerKeys: q.type === "multi_select" ? answerKeys : undefined,
  });

  if (step.kind === "complete") {
    const profile = await getQuizProfile({ shopDomain, sessionId, storeMode });
    return Response.json(
      { complete: true, profile },
      { status: 200, headers: auth.headers },
    );
  }

  const nextIdx = tree.questions.findIndex((x) => x.key === step.question.key);
  return Response.json(
    {
      question: {
        key: step.question.key,
        text: step.question.text,
        helpText: step.question.helpText ?? null,
        type: step.question.type,
        options: step.question.options,
        required: step.question.required ?? true,
      },
      currentIndex: Math.max(0, nextIdx),
      total: tree.expectedQuestionCount,
    },
    { status: 200, headers: auth.headers },
  );
};
