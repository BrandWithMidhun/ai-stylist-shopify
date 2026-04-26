import { z } from "zod";
import type { MerchantConfig } from "@prisma/client";
import prisma from "../db.server";
import { seedTaxonomy } from "./catalog/taxonomy-seeds";
import { seedRules } from "./catalog/rule-seeds";
import {
  CTA_LABEL_MAX,
  CTA_PLACEMENTS,
  STORE_MODES,
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
// default. NOTE: as of 007, this value is *advisory* — it represents the
// merchant's preferred name in the admin, but the storefront widget reads
// from the theme editor App Embed setting (agent_name_override) instead. v2
// will sync this value to an app metafield so the widget can read it without
// an extra fetch.
export function getEffectiveAgentName(config: MerchantConfig): string {
  return (
    config.chatAgentName?.trim() ||
    getDefaultAgentName(config.storeMode as StoreMode)
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
  return merchantConfigFormSchema.parse({
    storeMode: formData.get("storeMode"),
    chatWidgetEnabled: parseBoolField(formData.get("chatWidgetEnabled")),
    chatAgentName: agentName,
    ctaEnabled: parseBoolField(formData.get("ctaEnabled")),
    ctaLabel: formData.get("ctaLabel") ?? "",
    ctaPlacement: formData.get("ctaPlacement"),
    quizEnabled: parseBoolField(formData.get("quizEnabled")),
    lookbookEnabled: parseBoolField(formData.get("lookbookEnabled")),
    stylistAgentEnabled: parseBoolField(formData.get("stylistAgentEnabled")),
    commerceAgentEnabled: parseBoolField(formData.get("commerceAgentEnabled")),
  });
}
