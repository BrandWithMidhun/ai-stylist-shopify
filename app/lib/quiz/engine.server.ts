// Quiz engine — pure functions for tree traversal + DB-backed session ops.
//
// Pure functions:
//   nextQuestion(tree, answers, currentKey) — returns next key or completion
//   deriveProfile(answers, storeMode)       — converts raw answers to profile
//
// DB ops (Prisma):
//   getOrCreateSession  — idempotent, scoped to (shopDomain, sessionId, mode)
//   getSession          — read-only lookup
//   recordAnswer        — single answer upsert + advance currentQuestionKey
//   markSkipped         — terminate as SKIPPED, partial profile preserved
//   markCompleted       — terminate as COMPLETED
//   resetSession        — Edit-my-answers: wipe answers, re-NOT_STARTED
//   getQuizProfile      — read-only profile lookup for agent injection
//
// SECURITY: every DB lookup is scoped to (shopDomain, sessionId). The
// public-route guard validates shopDomain via installed Session; this
// module trusts the caller passed a verified shopDomain.

import type { QuizSession, StoreMode } from "@prisma/client";
import prisma from "../../db.server";
import { getTreeFor } from "./registry";
import type { AnswerMap, QuizProfile, QuizQuestion, QuizTree } from "./types";

export type NextStep =
  | { kind: "question"; question: QuizQuestion }
  | { kind: "complete" };

// Pure: walks the question's `next` rules in order, returns the first
// match. Throws if no rule matched (validateTree guarantees a default or
// complete rule, so this only fires on a partial DB row mid-flight, which
// the API routes guard against).
export function nextQuestion(
  tree: QuizTree,
  answers: AnswerMap,
  currentKey: string,
): NextStep {
  const q = tree.questions.find((x) => x.key === currentKey);
  if (!q) throw new Error(`question not found: ${currentKey}`);

  const answer = answers.get(currentKey);

  for (const rule of q.next) {
    if ("complete" in rule) return { kind: "complete" };
    if ("whenAnswerKey" in rule) {
      // whenAnswerKey only applies to single-select per validateTree.
      if (typeof answer === "string" && answer === rule.whenAnswerKey) {
        return resolve(tree, rule.goTo);
      }
      continue;
    }
    if ("default" in rule) {
      return resolve(tree, rule.goTo);
    }
  }

  throw new Error(`no rule matched for ${currentKey}`);
}

function resolve(tree: QuizTree, goTo: string): NextStep {
  const target = tree.questions.find((x) => x.key === goTo);
  if (!target) throw new Error(`goTo target not found: ${goTo}`);
  return { kind: "question", question: target };
}

// Pure: collapse a sessionId+answers row set into the typed profile shape.
// Order matters: the agent reads this string-rendered, so missing fields
// stay undefined rather than getting empty defaults.
export function deriveProfile(
  answers: AnswerMap,
  storeMode: StoreMode,
  completed: boolean,
): QuizProfile {
  const profile: QuizProfile = {
    storeMode,
    completed,
  };

  const single = (key: string): string | undefined => {
    const v = answers.get(key);
    return typeof v === "string" ? v : undefined;
  };
  const multi = (key: string): string[] | undefined => {
    const v = answers.get(key);
    return Array.isArray(v) && v.length > 0 ? v : undefined;
  };

  switch (storeMode) {
    case "FASHION":
      profile.gender = single("gender");
      profile.ageRange = single("age");
      profile.bodyType = single("body_type");
      profile.fitPreference = single("fit_preference");
      profile.lifestyle = single("lifestyle");
      profile.styleVibe = multi("style_vibe");
      profile.occasions = multi("occasions");
      profile.colorPreferences = multi("colors");
      profile.budgetTier = single("budget");
      break;
    case "JEWELLERY":
      profile.shoppingFor = single("shopping_for");
      profile.occasion = single("occasion");
      profile.metalPreference = single("metal");
      profile.jewelleryStyle = single("style");
      profile.gemstones = multi("gemstones");
      profile.budgetTier = single("budget");
      break;
    case "ELECTRONICS":
      profile.useCase = single("use_case");
      profile.platform = single("platform");
      profile.skillLevel = single("skill_level");
      profile.productCategories = multi("categories");
      profile.budgetTier = single("budget");
      profile.brandLoyalty = single("brand_loyalty");
      break;
    case "FURNITURE":
      profile.room = single("room");
      profile.spaceSize = single("space_size");
      profile.furnitureStyle = single("style");
      profile.permanence = single("permanence");
      profile.furnitureCategories = multi("categories");
      profile.budgetTier = single("budget");
      break;
    case "BEAUTY":
      profile.skinType = multi("skin_type");
      profile.concerns = multi("concerns");
      profile.routineComplexity = single("routine_complexity");
      profile.ingredientPreferences = multi("ingredient_preferences");
      profile.beautyCategories = multi("categories");
      profile.budgetTier = single("budget");
      break;
    case "GENERAL":
      profile.intent = single("intent");
      profile.budgetTier = single("budget");
      profile.freeText = multi("specifics")?.join(", ");
      break;
  }

  return profile;
}

// ────────── DB ops ──────────

export async function getOrCreateSession(input: {
  shopDomain: string;
  sessionId: string;
  storeMode: StoreMode;
}): Promise<QuizSession> {
  return prisma.quizSession.upsert({
    where: {
      shopDomain_sessionId_storeMode: {
        shopDomain: input.shopDomain,
        sessionId: input.sessionId,
        storeMode: input.storeMode,
      },
    },
    create: {
      shopDomain: input.shopDomain,
      sessionId: input.sessionId,
      storeMode: input.storeMode,
    },
    update: {},
  });
}

export async function getSession(input: {
  shopDomain: string;
  sessionId: string;
  storeMode: StoreMode;
}): Promise<(QuizSession & { answers: { questionKey: string; answerKey: string | null; answerKeys: string[] }[] }) | null> {
  return prisma.quizSession.findUnique({
    where: {
      shopDomain_sessionId_storeMode: {
        shopDomain: input.shopDomain,
        sessionId: input.sessionId,
        storeMode: input.storeMode,
      },
    },
    include: {
      answers: {
        select: { questionKey: true, answerKey: true, answerKeys: true },
      },
    },
  });
}

export function answersToMap(
  answers: { questionKey: string; answerKey: string | null; answerKeys: string[] }[],
): AnswerMap {
  const map: AnswerMap = new Map();
  for (const a of answers) {
    if (a.answerKeys && a.answerKeys.length > 0) {
      map.set(a.questionKey, a.answerKeys);
    } else if (a.answerKey != null) {
      map.set(a.questionKey, a.answerKey);
    }
  }
  return map;
}

export type RecordAnswerInput = {
  shopDomain: string;
  sessionId: string;
  storeMode: StoreMode;
  questionKey: string;
  answerKey?: string;
  answerKeys?: string[];
};

export async function recordAnswer(input: RecordAnswerInput): Promise<{
  session: QuizSession;
  step: NextStep;
}> {
  const tree = getTreeFor(input.storeMode);
  const q = tree.questions.find((x) => x.key === input.questionKey);
  if (!q) throw new Error(`unknown question: ${input.questionKey}`);

  const session = await getOrCreateSession(input);

  // Idempotent upsert keyed on (sessionId, questionKey).
  await prisma.quizAnswer.upsert({
    where: {
      sessionId_questionKey: {
        sessionId: session.id,
        questionKey: input.questionKey,
      },
    },
    create: {
      sessionId: session.id,
      questionKey: input.questionKey,
      answerKey: input.answerKey ?? null,
      answerKeys: input.answerKeys ?? [],
    },
    update: {
      answerKey: input.answerKey ?? null,
      answerKeys: input.answerKeys ?? [],
      answeredAt: new Date(),
    },
  });

  // Re-read answers including the one we just wrote, then evaluate next.
  const fresh = await getSession(input);
  if (!fresh) throw new Error("session vanished after upsert");
  const map = answersToMap(fresh.answers);
  const step = nextQuestion(tree, map, input.questionKey);

  if (step.kind === "complete") {
    const completed = await prisma.quizSession.update({
      where: { id: session.id },
      data: {
        state: "COMPLETED",
        completedAt: new Date(),
        currentQuestionKey: null,
        startedAt: session.startedAt ?? new Date(),
      },
    });
    return { session: completed, step };
  }

  const advanced = await prisma.quizSession.update({
    where: { id: session.id },
    data: {
      state: "IN_PROGRESS",
      currentQuestionKey: step.question.key,
      startedAt: session.startedAt ?? new Date(),
    },
  });
  return { session: advanced, step };
}

export async function markSkipped(input: {
  shopDomain: string;
  sessionId: string;
  storeMode: StoreMode;
}): Promise<QuizSession> {
  const session = await getOrCreateSession(input);
  return prisma.quizSession.update({
    where: { id: session.id },
    data: { state: "SKIPPED" },
  });
}

// "Edit my answers" — wipe all answers, set state to NOT_STARTED, clear
// currentQuestionKey so the next /start call walks from rootQuestionKey.
export async function resetSession(input: {
  shopDomain: string;
  sessionId: string;
  storeMode: StoreMode;
}): Promise<QuizSession> {
  const session = await getOrCreateSession(input);
  await prisma.quizAnswer.deleteMany({ where: { sessionId: session.id } });
  return prisma.quizSession.update({
    where: { id: session.id },
    data: {
      state: "NOT_STARTED",
      currentQuestionKey: null,
      startedAt: null,
      completedAt: null,
    },
  });
}

export async function startSession(input: {
  shopDomain: string;
  sessionId: string;
  storeMode: StoreMode;
}): Promise<{ session: QuizSession; question: QuizQuestion; tree: QuizTree }> {
  const tree = getTreeFor(input.storeMode);
  const session = await getOrCreateSession(input);

  // If the caller hits /start while a session is COMPLETED or SKIPPED, we
  // do NOT auto-reset — they must explicitly call /reset (Edit my answers).
  // This protects against accidental wipes when the widget re-mounts.
  // For NOT_STARTED or IN_PROGRESS, walk from currentQuestionKey or root.
  const startKey =
    session.currentQuestionKey &&
    tree.questions.some((q) => q.key === session.currentQuestionKey)
      ? session.currentQuestionKey
      : tree.rootQuestionKey;

  const question = tree.questions.find((x) => x.key === startKey);
  if (!question) throw new Error(`root question missing: ${startKey}`);

  const updated = await prisma.quizSession.update({
    where: { id: session.id },
    data: {
      state: session.state === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
      currentQuestionKey: startKey,
      startedAt: session.startedAt ?? new Date(),
    },
  });

  return { session: updated, question, tree };
}

// Read-only: returns the typed profile if the session has any answers.
// Returns null if no session, or session is NOT_STARTED with no answers.
// Caller (agent) treats null as "no profile" and keeps current behavior.
export async function getQuizProfile(input: {
  shopDomain: string;
  sessionId: string;
  storeMode: StoreMode;
}): Promise<QuizProfile | null> {
  const session = await getSession(input);
  if (!session) return null;
  if (session.answers.length === 0) return null;
  const map = answersToMap(session.answers);
  return deriveProfile(map, session.storeMode, session.state === "COMPLETED");
}
