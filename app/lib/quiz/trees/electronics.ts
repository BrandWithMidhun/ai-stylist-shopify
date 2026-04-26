// ELECTRONICS tree — 6 questions, use-case driven. No branching.

import type { QuizTree } from "../types";
import { BUDGET_TIERS_GENERIC } from "../commonOptions";

export const electronicsTree: QuizTree = {
  storeMode: "ELECTRONICS",
  expectedQuestionCount: 6,
  rootQuestionKey: "use_case",
  questions: [
    {
      key: "use_case",
      text: "What will you mostly use it for?",
      type: "single_select",
      options: [
        { key: "work", label: "Work / productivity" },
        { key: "gaming", label: "Gaming" },
        { key: "student", label: "Student / school" },
        { key: "creator", label: "Content creation" },
        { key: "casual", label: "Casual / everyday" },
      ],
      next: [{ default: true, goTo: "platform" }],
    },
    {
      key: "platform",
      text: "Any platform preference?",
      type: "single_select",
      options: [
        { key: "apple", label: "Apple" },
        { key: "android", label: "Android" },
        { key: "windows", label: "Windows" },
        { key: "cross_platform", label: "Cross-platform" },
        { key: "no_preference", label: "No preference" },
      ],
      next: [{ default: true, goTo: "skill_level" }],
    },
    {
      key: "skill_level",
      text: "How tech-savvy are you?",
      type: "single_select",
      options: [
        { key: "beginner", label: "Beginner" },
        { key: "intermediate", label: "Intermediate" },
        { key: "expert", label: "Expert" },
      ],
      next: [{ default: true, goTo: "categories" }],
    },
    {
      key: "categories",
      text: "What are you looking for?",
      helpText: "Pick as many as apply.",
      type: "multi_select",
      options: [
        { key: "laptop", label: "Laptop" },
        { key: "phone", label: "Phone" },
        { key: "audio", label: "Audio / headphones" },
        { key: "smart_home", label: "Smart home" },
        { key: "wearable", label: "Wearable" },
        { key: "accessories", label: "Accessories" },
      ],
      next: [{ default: true, goTo: "budget" }],
    },
    {
      key: "budget",
      text: "What's your budget?",
      type: "single_select",
      options: BUDGET_TIERS_GENERIC,
      next: [{ default: true, goTo: "brand_loyalty" }],
    },
    {
      key: "brand_loyalty",
      text: "Are you loyal to specific brands?",
      type: "single_select",
      options: [
        { key: "strict", label: "Yes — only certain brands" },
        { key: "open", label: "Open to anything" },
        { key: "no_preference", label: "No preference" },
      ],
      next: [{ complete: true }],
    },
  ],
};
