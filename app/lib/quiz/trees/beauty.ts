// BEAUTY tree — 6 questions, mostly multi-select for skin/concerns. No
// branching.

import type { QuizTree } from "../types";
import { BUDGET_TIERS_GENERIC } from "../commonOptions";

export const beautyTree: QuizTree = {
  storeMode: "BEAUTY",
  expectedQuestionCount: 6,
  rootQuestionKey: "skin_type",
  questions: [
    {
      key: "skin_type",
      text: "How would you describe your skin / hair?",
      helpText: "Pick all that apply.",
      type: "multi_select",
      options: [
        { key: "oily", label: "Oily" },
        { key: "dry", label: "Dry" },
        { key: "combination", label: "Combination" },
        { key: "sensitive", label: "Sensitive" },
        { key: "normal", label: "Normal" },
        { key: "frizzy", label: "Frizzy hair" },
        { key: "fine", label: "Fine hair" },
      ],
      next: [{ default: true, goTo: "concerns" }],
    },
    {
      key: "concerns",
      text: "What are your top concerns?",
      type: "multi_select",
      options: [
        { key: "anti_aging", label: "Anti-aging" },
        { key: "acne", label: "Acne" },
        { key: "hydration", label: "Hydration" },
        { key: "brightening", label: "Brightening" },
        { key: "sensitivity", label: "Sensitivity" },
        { key: "scalp", label: "Scalp care" },
      ],
      next: [{ default: true, goTo: "routine_complexity" }],
    },
    {
      key: "routine_complexity",
      text: "How elaborate is your routine?",
      type: "single_select",
      options: [
        { key: "minimal", label: "Minimal — a few essentials" },
        { key: "moderate", label: "Moderate — a steady routine" },
        { key: "extensive", label: "Extensive — I love the ritual" },
      ],
      next: [{ default: true, goTo: "ingredient_preferences" }],
    },
    {
      key: "ingredient_preferences",
      text: "Any ingredient preferences?",
      type: "multi_select",
      options: [
        { key: "vegan", label: "Vegan" },
        { key: "cruelty_free", label: "Cruelty-free" },
        { key: "fragrance_free", label: "Fragrance-free" },
        { key: "natural", label: "All-natural" },
        { key: "no_preference", label: "No preference" },
      ],
      next: [{ default: true, goTo: "categories" }],
    },
    {
      key: "categories",
      text: "What categories interest you?",
      type: "multi_select",
      options: [
        { key: "skincare", label: "Skincare" },
        { key: "makeup", label: "Makeup" },
        { key: "haircare", label: "Haircare" },
        { key: "fragrance", label: "Fragrance" },
        { key: "body", label: "Body care" },
      ],
      next: [{ default: true, goTo: "budget" }],
    },
    {
      key: "budget",
      text: "What's your budget?",
      type: "single_select",
      options: BUDGET_TIERS_GENERIC,
      next: [{ complete: true }],
    },
  ],
};
