// GENERAL tree — minimal 3 questions. No branching. Used as fallback when
// the merchant hasn't picked a vertical.

import type { QuizTree } from "../types";
import { BUDGET_TIERS_GENERIC } from "../commonOptions";

export const generalTree: QuizTree = {
  storeMode: "GENERAL",
  expectedQuestionCount: 3,
  rootQuestionKey: "intent",
  questions: [
    {
      key: "intent",
      text: "What brings you here today?",
      type: "single_select",
      options: [
        { key: "gift", label: "Looking for a gift" },
        { key: "treat", label: "Treat for myself" },
        { key: "replacement", label: "Replacing something" },
        { key: "exploring", label: "Just exploring" },
      ],
      next: [{ default: true, goTo: "budget" }],
    },
    {
      key: "budget",
      text: "What's your budget?",
      type: "single_select",
      options: BUDGET_TIERS_GENERIC,
      next: [{ default: true, goTo: "specifics" }],
    },
    {
      key: "specifics",
      text: "Anything specific to keep in mind?",
      helpText: "Optional — pick what fits.",
      type: "multi_select",
      options: [
        { key: "eco", label: "Eco-friendly" },
        { key: "local", label: "Local / small brand" },
        { key: "fast_ship", label: "Fast shipping" },
        { key: "no_preference", label: "No preference" },
      ],
      next: [{ complete: true }],
    },
  ],
};
