// Quiz tree types — used by tree definitions, the engine, and API routes.
//
// Trees are hardcoded TypeScript per storeMode for v1 (011a). 011b will
// move them to a DB-driven CRUD UI; until then, types here are the source
// of truth and validateTree() (registry.ts) catches bad authoring.

import type { StoreMode } from "../merchant-config";

export type QuizQuestionType = "single_select" | "multi_select";

export type QuizOption = {
  key: string;
  label: string;
  emoji?: string;
};

// Branching rules. Order matters: the engine walks them top-to-bottom and
// returns the first match. `whenAnswerKey` only applies to single-select
// questions in v1 (multi-select questions use default-only rules).
export type NextRule =
  | { whenAnswerKey: string; goTo: string }
  | { default: true; goTo: string }
  | { complete: true };

export type QuizQuestion = {
  key: string;
  text: string;
  helpText?: string;
  type: QuizQuestionType;
  options: QuizOption[];
  next: NextRule[];
  required?: boolean;
};

export type QuizTree = {
  storeMode: StoreMode;
  // Typical/average path length. Drives the progress bar denominator.
  // Branches longer than this cap the bar at 95% until completion (per
  // spec §3.7) — exact accuracy is not the goal; readable feedback is.
  expectedQuestionCount: number;
  // First question shown on quiz start. Must reference an existing key.
  rootQuestionKey: string;
  questions: QuizQuestion[];
};

// Mode-aware label for the quiz entry chip in the welcome chip row.
// Server (suggestions.server.ts) returns this via metafield; widget renders
// it as the first chip with a sparkle icon and a quiz-mode click handler.
export type QuizEntryConfig = {
  label: string;
};

// Profile derived from QuizAnswer rows after completion (or partial after
// skip). Fields are all optional because:
//   - the user may have skipped mid-flow,
//   - different storeModes populate different subsets,
//   - branches mean even a "completed" quiz won't touch every question.
//
// The agent receives this on every chat turn (post-quiz) and uses it to
// filter recommendations. New fields here are additive — agent must
// degrade gracefully when fields are missing.
export type QuizProfile = {
  storeMode: StoreMode;
  completed: boolean;
  // Common across modes
  budgetTier?: string;
  // FASHION
  gender?: string;
  ageRange?: string;
  bodyType?: string;
  fitPreference?: string;
  lifestyle?: string;
  styleVibe?: string[];
  occasions?: string[];
  colorPreferences?: string[];
  // JEWELLERY
  shoppingFor?: string;
  occasion?: string;
  metalPreference?: string;
  jewelleryStyle?: string;
  gemstones?: string[];
  // ELECTRONICS
  useCase?: string;
  platform?: string;
  skillLevel?: string;
  productCategories?: string[];
  brandLoyalty?: string;
  // FURNITURE
  room?: string;
  spaceSize?: string;
  furnitureStyle?: string;
  permanence?: string;
  furnitureCategories?: string[];
  // BEAUTY
  skinType?: string[];
  concerns?: string[];
  routineComplexity?: string;
  ingredientPreferences?: string[];
  beautyCategories?: string[];
  // GENERAL
  intent?: string;
  freeText?: string;
};

// Map of questionKey -> answer. Single-select stores a string; multi-select
// stores a string[]. Used by the engine to evaluate next rules and by the
// profile derivation step.
export type AnswerMap = Map<string, string | string[]>;
