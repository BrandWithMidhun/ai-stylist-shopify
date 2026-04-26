// Shared option groups reused across multiple trees. Extracting these here
// (rather than per-tree duplication) lets us tweak budget bands or color
// vocab in one place. Trees still own their own questions — only the
// option lists are shared.

import type { QuizOption } from "./types";

// Indian retail price bands. Shared across FASHION, JEWELLERY, ELECTRONICS,
// FURNITURE, BEAUTY, GENERAL — each tree wraps these in mode-appropriate
// budget questions (jewellery/furniture override with higher bands).
export const FASHION_BUDGET_TIERS: QuizOption[] = [
  { key: "budget", label: "Under ₹2,000" },
  { key: "midrange", label: "₹2,000 – ₹5,000" },
  { key: "premium", label: "₹5,000 – ₹10,000" },
  { key: "luxury", label: "₹10,000+" },
];

export const JEWELLERY_BUDGET_TIERS: QuizOption[] = [
  { key: "under_10k", label: "Under ₹10,000" },
  { key: "mid", label: "₹10,000 – ₹50,000" },
  { key: "premium", label: "₹50,000 – ₹1,00,000" },
  { key: "fine", label: "₹1,00,000+" },
];

export const FURNITURE_BUDGET_TIERS: QuizOption[] = [
  { key: "under_20k", label: "Under ₹20,000" },
  { key: "mid", label: "₹20,000 – ₹50,000" },
  { key: "premium", label: "₹50,000 – ₹1,00,000" },
  { key: "luxury", label: "₹1,00,000+" },
];

export const BUDGET_TIERS_GENERIC: QuizOption[] = [
  { key: "budget", label: "Budget-friendly" },
  { key: "midrange", label: "Mid-range" },
  { key: "premium", label: "Premium" },
  { key: "pro", label: "Pro / no limit" },
];

export const COLOR_FAMILIES: QuizOption[] = [
  { key: "neutrals", label: "Neutrals" },
  { key: "earth", label: "Earth tones" },
  { key: "jewel", label: "Jewel tones" },
  { key: "pastels", label: "Pastels" },
  { key: "brights", label: "Brights" },
  { key: "monochrome", label: "Monochrome" },
];

export const FASHION_AGE_RANGES: QuizOption[] = [
  { key: "teen", label: "Under 20" },
  { key: "young_adult", label: "20–30" },
  { key: "adult", label: "30–45" },
  { key: "senior", label: "45+" },
];
