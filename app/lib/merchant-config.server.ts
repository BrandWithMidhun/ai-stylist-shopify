import { z } from "zod";
import type { MerchantConfig } from "@prisma/client";
import prisma from "../db.server";
import { seedTaxonomy } from "./catalog/taxonomy-seeds";
import { seedRules } from "./catalog/rule-seeds";
import {
  CHAT_GRADIENT_ANGLE_MAX,
  CHAT_GRADIENT_ANGLE_MIN,
  CHAT_PRIMARY_COLOR_REGEX,
  CHAT_WELCOME_MESSAGE_MAX,
  CTA_LABEL_MAX,
  CTA_PLACEMENTS,
  DEFAULT_CHAT_GRADIENT_ANGLE,
  DEFAULT_CHAT_PRIMARY_COLOR,
  DEFAULT_CHAT_WELCOME_MESSAGE,
  SHOP_DISPLAY_NAME_MAX,
  STORE_MODES,
  deriveShopNameFromDomain,
  getDefaultAgentName,
  type CtaPlacement,
  type StoreMode,
} from "./merchant-config";

// NOTE on chatWidgetEnabled: as of 007 (storefront chat widget), this field
// is NOT read by the storefront widget. The actual storefront enable toggle
// lives in the theme app extension settings (App Embed > "Show chat bubble
// on storefront"). chatWidgetEnabled is reserved for a future v2 admin-side
// kill switch that will gate the embed regardless of theme editor state.

// Resolve the effective agent name for a merchant: their chatAgentName
// override (trimmed, non-empty) wins; otherwise fall back to the storeMode
// default. As of the 007 metafield refactor this value is now authoritative
// for the storefront — it gets serialized into the app-data metafield that
// the widget reads, so the theme editor no longer carries an override.
export function getEffectiveAgentName(config: MerchantConfig): string {
  return (
    config.chatAgentName?.trim() ||
    getDefaultAgentName(config.storeMode as StoreMode)
  );
}

// Resolve the effective shop name for chat copy: a merchant override wins,
// otherwise we fall back to a name derived from the myshopify domain.
// Used by the system prompt, welcome message, and metafield sync — every
// place chat copy needs to address the customer with a real-feeling shop
// name instead of the raw domain.
export function getEffectiveShopName(config: MerchantConfig): string {
  return (
    config.shopDisplayName?.trim() ||
    deriveShopNameFromDomain(config.shop)
  );
}


export const merchantConfigFormSchema = z.object({
  storeMode: z.enum(STORE_MODES),
  chatWidgetEnabled: z.boolean(),
  chatAgentName: z
    .string()
    .trim()
    .max(60)
    .nullable(),
  shopDisplayName: z
    .string()
    .trim()
    .max(SHOP_DISPLAY_NAME_MAX)
    .nullable(),
  chatPrimaryColor: z
    .string()
    .trim()
    .regex(CHAT_PRIMARY_COLOR_REGEX, "Use a 6-digit hex like #000000."),
  // 011a: 2-stop gradient. End color null = solid color (gradient off).
  chatPrimaryColorEnd: z
    .string()
    .trim()
    .regex(CHAT_PRIMARY_COLOR_REGEX, "Use a 6-digit hex like #000000.")
    .nullable(),
  chatPrimaryGradientAngle: z
    .number()
    .int()
    .min(CHAT_GRADIENT_ANGLE_MIN)
    .max(CHAT_GRADIENT_ANGLE_MAX),
  chatWelcomeMessage: z
    .string()
    .trim()
    .min(1)
    .max(CHAT_WELCOME_MESSAGE_MAX),
  ctaEnabled: z.boolean(),
  ctaLabel: z.string().trim().min(1).max(CTA_LABEL_MAX),
  ctaPlacement: z.enum(CTA_PLACEMENTS),
  quizEnabled: z.boolean(),
  lookbookEnabled: z.boolean(),
  stylistAgentEnabled: z.boolean(),
  commerceAgentEnabled: z.boolean(),
});

export type MerchantConfigInput = z.infer<typeof merchantConfigFormSchema>;

export function defaultMerchantConfig(shop: string): MerchantConfigInput & {
  shop: string;
} {
  return {
    shop,
    storeMode: "GENERAL" satisfies StoreMode,
    chatWidgetEnabled: true,
    chatAgentName: null,
    shopDisplayName: null,
    chatPrimaryColor: DEFAULT_CHAT_PRIMARY_COLOR,
    chatPrimaryColorEnd: null,
    chatPrimaryGradientAngle: DEFAULT_CHAT_GRADIENT_ANGLE,
    chatWelcomeMessage: DEFAULT_CHAT_WELCOME_MESSAGE,
    ctaEnabled: true,
    ctaLabel: "Need help choosing?",
    ctaPlacement: "PRODUCT_PAGE" satisfies CtaPlacement,
    quizEnabled: true,
    lookbookEnabled: false,
    stylistAgentEnabled: false,
    commerceAgentEnabled: true,
  };
}

export async function getMerchantConfig(
  shop: string,
): Promise<MerchantConfig | null> {
  return prisma.merchantConfig.findUnique({ where: { shop } });
}

// Defense-in-depth: guarantee the row exists before any downstream code reads
// it. Schema defaults populate every column except shop, so create needs only
// { shop }. Update is a no-op so a pre-existing row is untouched.
export async function ensureMerchantConfig(
  shop: string,
): Promise<MerchantConfig> {
  return prisma.merchantConfig.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });
}

export async function upsertMerchantConfig(
  shop: string,
  input: MerchantConfigInput,
): Promise<MerchantConfig> {
  const config = await prisma.merchantConfig.upsert({
    where: { shop },
    create: { shop, ...input },
    update: input,
  });

  // 006a §4.1 / §5.5: when a merchant saves the config form, ensure
  // taxonomy + rule seeds exist for the chosen storeMode. Both seeders
  // bail on already-seeded shops (idempotent on subsequent calls) so
  // re-saving the form (or switching storeMode and back) won't clobber
  // merchant edits. We log silently rather than failing the form save —
  // a seed failure here shouldn't block the merchant from updating CTA
  // text or feature toggles.
  try {
    await seedTaxonomy(shop, input.storeMode as StoreMode);
    await seedRules(shop, input.storeMode as StoreMode);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[merchant-config] seed failed for ${shop}:`, err);
  }

  return config;
}

function parseBoolField(value: FormDataEntryValue | null): boolean {
  return value !== null && value !== "" && value !== "false";
}

export function parseFormData(formData: FormData): MerchantConfigInput {
  const rawAgentName = formData.get("chatAgentName");
  const agentName =
    typeof rawAgentName === "string" && rawAgentName.trim() !== ""
      ? rawAgentName.trim()
      : null;
  const rawShopDisplayName = formData.get("shopDisplayName");
  const shopDisplayName =
    typeof rawShopDisplayName === "string" && rawShopDisplayName.trim() !== ""
      ? rawShopDisplayName.trim()
      : null;
  // Gradient toggle drives whether the end color persists. When the
  // checkbox is off, we explicitly nullify chatPrimaryColorEnd so a stale
  // value from a prior save doesn't keep rendering as a gradient.
  const gradientEnabled = parseBoolField(formData.get("chatPrimaryGradientEnabled"));
  const rawEndColor = formData.get("chatPrimaryColorEnd");
  const endColor =
    gradientEnabled && typeof rawEndColor === "string" && rawEndColor.trim() !== ""
      ? rawEndColor.trim()
      : null;
  const rawAngle = formData.get("chatPrimaryGradientAngle");
  const angleNum =
    typeof rawAngle === "string" && rawAngle.trim() !== ""
      ? Number(rawAngle)
      : DEFAULT_CHAT_GRADIENT_ANGLE;

  return merchantConfigFormSchema.parse({
    storeMode: formData.get("storeMode"),
    chatWidgetEnabled: parseBoolField(formData.get("chatWidgetEnabled")),
    chatAgentName: agentName,
    shopDisplayName,
    chatPrimaryColor: formData.get("chatPrimaryColor") ?? "",
    chatPrimaryColorEnd: endColor,
    chatPrimaryGradientAngle: Number.isFinite(angleNum) ? angleNum : DEFAULT_CHAT_GRADIENT_ANGLE,
    chatWelcomeMessage: formData.get("chatWelcomeMessage") ?? "",
    ctaEnabled: parseBoolField(formData.get("ctaEnabled")),
    ctaLabel: formData.get("ctaLabel") ?? "",
    ctaPlacement: formData.get("ctaPlacement"),
    quizEnabled: parseBoolField(formData.get("quizEnabled")),
    lookbookEnabled: parseBoolField(formData.get("lookbookEnabled")),
    stylistAgentEnabled: parseBoolField(formData.get("stylistAgentEnabled")),
    commerceAgentEnabled: parseBoolField(formData.get("commerceAgentEnabled")),
  });
}
