// Hardcoded canned response generator for 007 — the chat shell.
//
// Real intelligence (agent orchestrator + commerce/stylist agents) lands in
// 008+, hitting the same /api/chat/message endpoint. The widget never changes.
//
// v1: industry-neutral suggestion chips. Mode-aware chips come in 011 (quiz/
// onboarding) when storeMode-specific suggestions become useful.

export type ProductContext = {
  handle?: string;
  title?: string;
  imageUrl?: string;
  variantId?: string;
} | null;

export type CannedResponse = {
  content: string;
  suggestions: string[];
};

const SHOW_PATTERN = /^(show me|find|looking for)/i;
const THANKS_PATTERN = /(thank|thanks)/i;

// Suggestion chip pools — colocated for v1. Defer i18n to when we have
// non-English merchants; trying to extract these into a shared bundle now
// would be premature.
const WELCOME_CHIPS = [
  "Show me what's new",
  "Help me find a gift",
  "What's trending?",
  "I'm just browsing",
];

const SEARCH_FOLLOWUP_CHIPS = [
  "Show me what's popular",
  "Help me narrow down",
  "Something else",
];

const THANKS_FOLLOWUP_CHIPS = [
  "Show me what's new",
  "Help me find a gift",
  "I'm done for now",
];

const CONTEXT_FOLLOWUP_CHIPS = [
  "Tell me more",
  "Show me similar items",
  "Something else",
];

const FALLBACK_CHIPS = [
  "Show me what's new",
  "Help me find a gift",
  "What's trending?",
];

export function matchResponse(input: {
  text: string;
  context: ProductContext;
  isFirstMessage: boolean;
}): CannedResponse {
  const { text, context, isFirstMessage } = input;
  const trimmed = (text || "").trim();

  if (isFirstMessage) {
    return {
      content: "Hi! I'm your shopping assistant. How can I help you today?",
      suggestions: WELCOME_CHIPS,
    };
  }

  if (SHOW_PATTERN.test(trimmed)) {
    return {
      content:
        "I'd love to help you find something! Real product search coming soon.",
      suggestions: SEARCH_FOLLOWUP_CHIPS,
    };
  }

  if (THANKS_PATTERN.test(trimmed)) {
    return {
      content: "You're welcome! Anything else?",
      suggestions: THANKS_FOLLOWUP_CHIPS,
    };
  }

  if (context && context.title) {
    return {
      content: `Got it, you're asking about ${context.title}. Real product help coming soon.`,
      suggestions: CONTEXT_FOLLOWUP_CHIPS,
    };
  }

  return {
    content:
      "Thanks for that! I'm still learning. The full AI experience launches soon.",
    suggestions: FALLBACK_CHIPS,
  };
}
