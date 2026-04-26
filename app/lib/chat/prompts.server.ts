// Mode-aware system prompt builder for the chat agent.
//
// The base prompt is universal (identity, tool-usage rules, tone). The mode
// context is appended to give Claude the vocabulary of the store. Adding a
// new mode is one entry in MODE_CONTEXT.
//
// 011a: optional quizProfile arg appends a "What we know about this
// shopper" block when the user has completed (or partially completed) the
// onboarding quiz. The block is capped at ~300 tokens to avoid prompt
// bloat from a future regression in deriveProfile.

import type { MerchantConfig } from "@prisma/client";
import {
  getEffectiveAgentName,
  getEffectiveShopName,
} from "../merchant-config.server";
import {
  DEFAULT_CHAT_WELCOME_MESSAGE,
  type StoreMode,
} from "../merchant-config";
import type { QuizProfile } from "../quiz/types";

const PROFILE_BLOCK_MAX_CHARS = 1200; // ~300 tokens at 4 chars/token

export function buildSystemPrompt(
  config: MerchantConfig,
  quizProfile?: QuizProfile | null,
): string {
  const shopName = getEffectiveShopName(config);
  const agentName = getEffectiveAgentName(config);

  const base = `You are ${agentName}, a shopping assistant for ${shopName}. Your job is to help customers find products they'll love.

You have access to a product search tool. Use it whenever the user wants to find, browse, or compare products. Be specific in your search queries — extract attributes like color, material, occasion, price range from what the user says.

When products are returned, write a natural recommendation in 1-3 sentences. Do not list product names mechanically — pick the most relevant 2-3 and describe why they fit. The product cards will display below your message automatically; do not include URLs, prices, or images in your text.

Tone: friendly, concise, helpful. Avoid emoji. Avoid sales-y language.

If you don't know something, say so. Don't make up product details.`;

  const modeContext = MODE_CONTEXT[config.storeMode as StoreMode](shopName);
  const profileBlock = renderProfileBlock(quizProfile);
  return profileBlock
    ? `${base}\n\n${modeContext}\n\n${profileBlock}`
    : `${base}\n\n${modeContext}`;
}

// Renders a compact bullet list of profile facts for the system prompt.
// Returns empty string when profile is null/empty (caller skips the
// block entirely). The "Use this profile when relevant" closing line per
// execution plan addition C lets Claude prioritize the user's current
// request when it conflicts with the profile (e.g., shopping for someone
// else).
function renderProfileBlock(profile: QuizProfile | null | undefined): string {
  if (!profile) return "";
  const lines: string[] = [];
  const push = (label: string, value: string | string[] | undefined) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      lines.push(`- ${label}: ${value.join(", ")}`);
    } else if (value.length > 0) {
      lines.push(`- ${label}: ${value}`);
    }
  };

  push("Gender", profile.gender);
  push("Age range", profile.ageRange);
  push("Body type", profile.bodyType);
  push("Fit preference", profile.fitPreference);
  push("Lifestyle", profile.lifestyle);
  push("Style vibe", profile.styleVibe);
  push("Occasions", profile.occasions);
  push("Color preferences", profile.colorPreferences);
  push("Shopping for", profile.shoppingFor);
  push("Occasion", profile.occasion);
  push("Metal preference", profile.metalPreference);
  push("Jewellery style", profile.jewelleryStyle);
  push("Gemstones", profile.gemstones);
  push("Use case", profile.useCase);
  push("Platform", profile.platform);
  push("Skill level", profile.skillLevel);
  push("Product categories", profile.productCategories);
  push("Brand loyalty", profile.brandLoyalty);
  push("Room", profile.room);
  push("Space size", profile.spaceSize);
  push("Furniture style", profile.furnitureStyle);
  push("Permanence", profile.permanence);
  push("Furniture categories", profile.furnitureCategories);
  push("Skin / hair type", profile.skinType);
  push("Concerns", profile.concerns);
  push("Routine complexity", profile.routineComplexity);
  push("Ingredient preferences", profile.ingredientPreferences);
  push("Beauty categories", profile.beautyCategories);
  push("Intent", profile.intent);
  push("Notes", profile.freeText);
  push("Budget tier", profile.budgetTier);

  if (lines.length === 0) return "";

  const heading = profile.completed
    ? "## What we know about this shopper"
    : "## What we know about this shopper (partial profile)";
  const body = lines.join("\n");
  const closer =
    "Use this profile when relevant. If the user's request doesn't match their profile (e.g., shopping for someone else), prioritize the request over the profile. Do not reference these facts back to the user verbatim.";

  let block = `${heading}\n${body}\n\n${closer}`;
  if (block.length > PROFILE_BLOCK_MAX_CHARS) {
    block = block.slice(0, PROFILE_BLOCK_MAX_CHARS) + "…";
  }
  return block;
}

// Mode-aware welcome message templates per spec §3.2. Placeholders:
//   {agentName} — resolved via getEffectiveAgentName
//   {shopName}  — resolved via getEffectiveShopName
// If the merchant has overridden chatWelcomeMessage to anything other than
// the legacy default, that override wins (placeholders still get replaced
// for forward-compat). New shops, and shops still on the default copy,
// pick up the mode-aware template automatically.
export function getWelcomeMessage(config: MerchantConfig): string {
  const agentName = getEffectiveAgentName(config);
  const shopName = getEffectiveShopName(config);

  const merchantOverride = config.chatWelcomeMessage?.trim();
  const template =
    merchantOverride && merchantOverride !== DEFAULT_CHAT_WELCOME_MESSAGE
      ? merchantOverride
      : WELCOME_TEMPLATES[config.storeMode as StoreMode];

  return template
    .replaceAll("{agentName}", agentName)
    .replaceAll("{shopName}", shopName);
}

const WELCOME_TEMPLATES: Record<StoreMode, string> = {
  FASHION:
    "Hi, I'm {agentName} from {shopName}. How can I help you find your next favorite piece?",
  JEWELLERY:
    "Hi, I'm {agentName} from {shopName}. How can I help you find your next favorite piece?",
  ELECTRONICS:
    "Hi, I'm {agentName} from {shopName}. What can I help you find today?",
  FURNITURE:
    "Hi, I'm {agentName} from {shopName}. Let me help you find the perfect piece for your space.",
  BEAUTY:
    "Hi, I'm {agentName} from {shopName}. Looking for something in particular?",
  GENERAL:
    "Hi, I'm {agentName} from {shopName}. What can I help you find?",
};

const MODE_CONTEXT: Record<StoreMode, (shopName: string) => string> = {
  FASHION: (shopName) =>
    `${shopName} sells clothing and accessories. Common queries: outfit advice, size questions, occasion-based requests, gift recommendations. The catalog is tagged with: gender, fit, material, occasion, style, size, color.`,

  JEWELLERY: (shopName) =>
    `${shopName} sells jewellery (rings, necklaces, earrings, bangles, etc.). Many products have purity (22k, 18k, 925), gemstones, and craft type (kundan, polki, meenakari) attributes. Common queries: bridal collections, gifts, daily wear, men's jewellery. Be respectful of cultural context — bridal jewellery is significant.`,

  ELECTRONICS: (shopName) =>
    `${shopName} sells electronics and gadgets. Common queries: feature comparisons, compatibility (works with iPhone? Android?), use cases (gaming, professional, content creation). Tags include: connectivity, color, target_user.`,

  FURNITURE: (shopName) =>
    `${shopName} sells furniture. Common queries: room planning, dimensions, style fit (modern, rustic, etc.), assembly. Be aware of room context (living, bedroom, dining, outdoor).`,

  BEAUTY: (shopName) =>
    `${shopName} sells beauty and personal care products. Common queries: skin/hair concerns, ingredient questions (vegan, cruelty-free), routines. Be sensitive to skin type variations.`,

  GENERAL: (shopName) =>
    `${shopName} sells a variety of products. Help the customer find what they need; ask clarifying questions if intent is unclear.`,
};
