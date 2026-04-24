import { z } from "zod";
import { callClaude } from "./anthropic.server";
import type { StoreMode } from "./merchant-config";
import type { Product } from "./shopify-products.server";

export const tagsSchema = z
  .object({
    category: z.string().min(1),
    style: z.array(z.string()),
    occasion: z.array(z.string()),
    color: z.array(z.string()),
    material: z.array(z.string()),
  })
  .strict();

export type Tags = z.infer<typeof tagsSchema>;

export type TagResult =
  | { ok: true; productId: string; tags: Tags }
  | { ok: false; productId: string; error: string };

const FASHION_CONTEXT =
  "You are a product tagging assistant for a Fashion Shopify store. Focus on extracting style, occasion, material, and color. Favor concrete, shopper-facing terms (e.g. \"summer\", \"evening\", \"linen\") over vague labels.";

const GENERIC_CONTEXT =
  "You are a product tagging assistant for a General Shopify store. Focus on category and key product attributes. Fill style/occasion/material/color only when the product clearly implies them — leave arrays empty otherwise.";

function contextForMode(mode: StoreMode): string {
  return mode === "FASHION" ? FASHION_CONTEXT : GENERIC_CONTEXT;
}

function buildPrompt(product: Product, storeMode: StoreMode): string {
  const lines: string[] = [];
  lines.push(contextForMode(storeMode));
  lines.push("");
  lines.push("Product:");
  lines.push(`- Title: ${product.title}`);
  if (product.description.trim().length > 0) {
    lines.push(`- Description: ${product.description}`);
  }
  if (product.tags.length > 0) {
    lines.push(`- Current tags: ${product.tags.join(", ")}`);
  }
  if (product.imageAlt && product.imageAlt.trim().length > 0) {
    lines.push(`- Image alt text: ${product.imageAlt}`);
  }
  lines.push("");
  lines.push(
    "Return a JSON object matching EXACTLY this schema — no markdown, no commentary, no fields outside the schema:",
  );
  lines.push("{");
  lines.push("  \"category\": string,");
  lines.push("  \"style\": string[],");
  lines.push("  \"occasion\": string[],");
  lines.push("  \"color\": string[],");
  lines.push("  \"material\": string[]");
  lines.push("}");
  lines.push("");
  lines.push("Rules:");
  lines.push(
    "- category is required and must be a single noun describing what the product is.",
  );
  lines.push(
    "- All array fields must be present. Use [] when no confident value applies.",
  );
  lines.push("- Use lowercase for array values. Use Title Case for category.");
  lines.push("- Return only the JSON object, starting with {.");
  return lines.join("\n");
}

export async function generateTagsForProduct(
  product: Product,
  storeMode: StoreMode,
): Promise<TagResult> {
  const prompt = buildPrompt(product, storeMode);
  const response = await callClaude(prompt, {
    temperature: 0.3,
    prefill: "{",
  });

  if (!response.ok) {
    return { ok: false, productId: product.id, error: response.error };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return {
      ok: false,
      productId: product.id,
      error: "Claude returned malformed JSON.",
    };
  }

  const validation = tagsSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      ok: false,
      productId: product.id,
      error: "Claude response did not match tag schema.",
    };
  }

  return { ok: true, productId: product.id, tags: validation.data };
}
