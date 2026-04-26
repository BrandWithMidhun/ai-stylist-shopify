// JEWELLERY tree — 6 questions, no branching. Bridal/festive vocabulary
// matters more than gender here. Profile feeds the agent for craft-aware
// recommendations (kundan, polki, meenakari) defined in prompts.server.ts.

import type { QuizTree } from "../types";
import { JEWELLERY_BUDGET_TIERS } from "../commonOptions";

export const jewelleryTree: QuizTree = {
  storeMode: "JEWELLERY",
  expectedQuestionCount: 6,
  rootQuestionKey: "shopping_for",
  questions: [
    {
      key: "shopping_for",
      text: "Who are you shopping for?",
      type: "single_select",
      options: [
        { key: "self", label: "Myself" },
        { key: "spouse", label: "Spouse / partner" },
        { key: "family", label: "Family" },
        { key: "gift", label: "A gift" },
      ],
      next: [{ default: true, goTo: "occasion" }],
    },
    {
      key: "occasion",
      text: "What's the occasion?",
      type: "single_select",
      options: [
        { key: "daily", label: "Daily wear" },
        { key: "festive", label: "Festive" },
        { key: "bridal", label: "Bridal" },
        { key: "gift", label: "Gift" },
        { key: "religious", label: "Religious / ceremonial" },
      ],
      next: [{ default: true, goTo: "metal" }],
    },
    {
      key: "metal",
      text: "Any metal preference?",
      type: "single_select",
      options: [
        { key: "gold", label: "Gold" },
        { key: "silver", label: "Silver" },
        { key: "platinum", label: "Platinum" },
        { key: "mixed", label: "Mixed metals" },
        { key: "no_preference", label: "Show me anything" },
      ],
      next: [{ default: true, goTo: "style" }],
    },
    {
      key: "style",
      text: "What style speaks to you?",
      type: "single_select",
      options: [
        { key: "traditional", label: "Traditional" },
        { key: "contemporary", label: "Contemporary" },
        { key: "minimalist", label: "Minimalist" },
        { key: "statement", label: "Statement" },
      ],
      next: [{ default: true, goTo: "gemstones" }],
    },
    {
      key: "gemstones",
      text: "Which gemstones interest you?",
      helpText: "Pick as many as you like.",
      type: "multi_select",
      options: [
        { key: "diamond", label: "Diamond" },
        { key: "ruby", label: "Ruby" },
        { key: "emerald", label: "Emerald" },
        { key: "sapphire", label: "Sapphire" },
        { key: "pearl", label: "Pearl" },
        { key: "none", label: "None / show me anything" },
      ],
      next: [{ default: true, goTo: "budget" }],
    },
    {
      key: "budget",
      text: "What's your budget?",
      type: "single_select",
      options: JEWELLERY_BUDGET_TIERS,
      next: [{ complete: true }],
    },
  ],
};
