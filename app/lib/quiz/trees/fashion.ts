// FASHION quiz tree — 8 questions with gender-driven branching for
// fit/body. Branches converge to lifestyle → vibe → occasions → colors →
// budget so the deeper path is shared.

import type { QuizTree } from "../types";
import {
  COLOR_FAMILIES,
  FASHION_AGE_RANGES,
  FASHION_BUDGET_TIERS,
} from "../commonOptions";

export const fashionTree: QuizTree = {
  storeMode: "FASHION",
  expectedQuestionCount: 8,
  rootQuestionKey: "gender",
  questions: [
    {
      key: "gender",
      text: "Who are you shopping for?",
      type: "single_select",
      options: [
        { key: "men", label: "Men" },
        { key: "women", label: "Women" },
        { key: "unisex", label: "Both" },
        { key: "kids", label: "Kids" },
      ],
      next: [
        { whenAnswerKey: "women", goTo: "body_type" },
        { whenAnswerKey: "men", goTo: "fit_preference" },
        { whenAnswerKey: "unisex", goTo: "fit_preference" },
        { whenAnswerKey: "kids", goTo: "age" },
        { default: true, goTo: "fit_preference" },
      ],
    },
    {
      key: "body_type",
      text: "How would you describe your fit preference?",
      helpText: "We use this to surface flattering cuts.",
      type: "single_select",
      options: [
        { key: "fitted", label: "Fitted / bodycon" },
        { key: "structured", label: "Structured / tailored" },
        { key: "relaxed", label: "Relaxed / flowy" },
        { key: "no_preference", label: "No preference" },
      ],
      next: [{ default: true, goTo: "age" }],
    },
    {
      key: "fit_preference",
      text: "How do you like your clothes to fit?",
      type: "single_select",
      options: [
        { key: "slim", label: "Slim" },
        { key: "regular", label: "Regular" },
        { key: "relaxed", label: "Relaxed" },
        { key: "oversized", label: "Oversized" },
      ],
      next: [{ default: true, goTo: "age" }],
    },
    {
      key: "age",
      text: "What's your age range?",
      type: "single_select",
      options: FASHION_AGE_RANGES,
      next: [{ default: true, goTo: "lifestyle" }],
    },
    {
      key: "lifestyle",
      text: "Which best describes your lifestyle?",
      type: "single_select",
      options: [
        { key: "work", label: "Work-focused" },
        { key: "casual", label: "Mostly casual" },
        { key: "mixed", label: "A bit of everything" },
        { key: "festive", label: "Festive / event-heavy" },
      ],
      next: [{ default: true, goTo: "style_vibe" }],
    },
    {
      key: "style_vibe",
      text: "Which style vibes feel like you?",
      helpText: "Pick as many as you like.",
      type: "multi_select",
      options: [
        { key: "minimalist", label: "Minimalist" },
        { key: "traditional", label: "Traditional" },
        { key: "contemporary", label: "Contemporary" },
        { key: "statement", label: "Statement" },
        { key: "sporty", label: "Sporty" },
        { key: "vintage", label: "Vintage" },
      ],
      next: [{ default: true, goTo: "occasions" }],
    },
    {
      key: "occasions",
      text: "What occasions do you shop for most?",
      type: "multi_select",
      options: [
        { key: "daily", label: "Daily wear" },
        { key: "work", label: "Work" },
        { key: "festive", label: "Festive" },
        { key: "party", label: "Party / nightlife" },
        { key: "sport", label: "Sport / activewear" },
        { key: "travel", label: "Travel" },
      ],
      next: [{ default: true, goTo: "colors" }],
    },
    {
      key: "colors",
      text: "Which color families do you reach for?",
      type: "multi_select",
      options: COLOR_FAMILIES,
      next: [{ default: true, goTo: "budget" }],
    },
    {
      key: "budget",
      text: "What's your typical budget per piece?",
      type: "single_select",
      options: FASHION_BUDGET_TIERS,
      next: [{ complete: true }],
    },
  ],
};
