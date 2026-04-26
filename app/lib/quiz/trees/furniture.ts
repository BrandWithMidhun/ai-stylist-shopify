// FURNITURE tree — 6 questions, room/space-driven. No branching.

import type { QuizTree } from "../types";
import { FURNITURE_BUDGET_TIERS } from "../commonOptions";

export const furnitureTree: QuizTree = {
  storeMode: "FURNITURE",
  expectedQuestionCount: 6,
  rootQuestionKey: "room",
  questions: [
    {
      key: "room",
      text: "Which room are you furnishing?",
      type: "single_select",
      options: [
        { key: "living", label: "Living room" },
        { key: "bedroom", label: "Bedroom" },
        { key: "dining", label: "Dining" },
        { key: "office", label: "Home office" },
        { key: "outdoor", label: "Outdoor" },
        { key: "whole_house", label: "Whole house" },
      ],
      next: [{ default: true, goTo: "space_size" }],
    },
    {
      key: "space_size",
      text: "How big is the space?",
      type: "single_select",
      options: [
        { key: "small", label: "Small / studio" },
        { key: "medium", label: "Medium" },
        { key: "large", label: "Large" },
        { key: "open_plan", label: "Open plan" },
      ],
      next: [{ default: true, goTo: "style" }],
    },
    {
      key: "style",
      text: "What's your style?",
      type: "single_select",
      options: [
        { key: "modern", label: "Modern" },
        { key: "rustic", label: "Rustic" },
        { key: "industrial", label: "Industrial" },
        { key: "traditional", label: "Traditional" },
        { key: "mixed", label: "Mixed / eclectic" },
      ],
      next: [{ default: true, goTo: "permanence" }],
    },
    {
      key: "permanence",
      text: "Where are you in your home journey?",
      type: "single_select",
      options: [
        { key: "renting", label: "Renting / moving soon" },
        { key: "permanent", label: "Long-term home" },
        { key: "mixed", label: "A bit of both" },
      ],
      next: [{ default: true, goTo: "categories" }],
    },
    {
      key: "categories",
      text: "What are you furnishing?",
      type: "multi_select",
      options: [
        { key: "sofas", label: "Sofas / seating" },
        { key: "beds", label: "Beds / mattresses" },
        { key: "tables", label: "Tables" },
        { key: "storage", label: "Storage" },
        { key: "decor", label: "Decor" },
        { key: "lighting", label: "Lighting" },
      ],
      next: [{ default: true, goTo: "budget" }],
    },
    {
      key: "budget",
      text: "What's your budget per piece?",
      type: "single_select",
      options: FURNITURE_BUDGET_TIERS,
      next: [{ complete: true }],
    },
  ],
};
