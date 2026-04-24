// AI tagging: turns a Product into a set of axis/value tags via Claude.
//
// Design decisions (from execution plan):
//   - Starter axes are hardcoded per storeMode (decision 9). Claude is
//     prompted to add more axes if the product clearly warrants them, keeping
//     names snake_case and stable.
//   - MerchantConfig.storeMode is passed into the prompt (decision 11). If
//     null, default to "general".
//   - Respects ProductTag.locked (spec 6.4): locked axes on this product are
//     excluded from re-generation entirely — the model doesn't even see them.
//   - Audit: every ADD writes a ProductTagAudit row with source=AI.

import Anthropic from "@anthropic-ai/sdk";
import type { Product, ProductTag } from "@prisma/client";
import { z } from "zod";
import prisma from "../../db.server";

const MODEL = "claude-sonnet-4-5";
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.2;

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (client) return client;
  // eslint-disable-next-line no-undef
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  client = new Anthropic({ apiKey: key });
  return client;
}

type StoreMode =
  | "FASHION"
  | "ELECTRONICS"
  | "FURNITURE"
  | "BEAUTY"
  | "GENERAL";

const STARTER_AXES: Record<StoreMode, string[]> = {
  FASHION: ["category", "style", "occasion", "color_family", "fit", "season"],
  ELECTRONICS: ["category", "brand", "form_factor", "use_case", "price_tier"],
  FURNITURE: ["category", "style", "material", "room", "size_class"],
  BEAUTY: ["category", "skin_type", "concern", "ingredient_class", "finish"],
  GENERAL: ["category", "color", "style", "use_case"],
};

const TagItemSchema = z.object({
  axis: z.string().min(1).max(64),
  value: z.string().min(1).max(128),
  confidence: z.number().min(0).max(1).optional(),
});

const TagResponseSchema = z.object({
  tags: z.array(TagItemSchema),
});

export type GeneratedTag = z.infer<typeof TagItemSchema>;

export type GenerateResult =
  | { ok: true; tags: Array<GeneratedTag & { skippedLocked?: boolean }>; writtenCount: number }
  | { ok: false; error: string };

export async function generateTagsForProduct(params: {
  shopDomain: string;
  product: Product & { tags: ProductTag[] };
  storeMode: StoreMode | null;
  actorId?: string | null;
}): Promise<GenerateResult> {
  const anthropic = getClient();
  if (!anthropic) {
    return { ok: false, error: "Anthropic API key not configured." };
  }

  const mode: StoreMode = params.storeMode ?? "GENERAL";
  const starterAxes = STARTER_AXES[mode];
  const lockedAxes = new Set(
    params.product.tags.filter((t) => t.locked).map((t) => t.axis),
  );

  const promptPayload = {
    storeMode: mode.toLowerCase(),
    starterAxes,
    lockedAxes: Array.from(lockedAxes),
    product: {
      title: params.product.title,
      description: stripHtml(params.product.descriptionHtml ?? ""),
      productType: params.product.productType,
      vendor: params.product.vendor,
      shopifyTags: params.product.shopifyTags,
    },
  };

  const systemPrompt = `You are a catalog tagging assistant for a ${mode.toLowerCase()} store. Tag the product along the provided starter axes. These are suggested axes — add more if the product clearly warrants them. Keep axis names snake_case and stable across products. Do NOT return tags for any axis in lockedAxes. Respond with JSON ONLY in the form {"tags":[{"axis":"...","value":"...","confidence":0.0}]} — confidence is 0.0–1.0.`;

  let text: string;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: JSON.stringify(promptPayload),
        },
      ],
    });
    const block = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    if (!block) {
      return { ok: false, error: "Claude returned no text content." };
    }
    text = block.text;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ai-tagger] Claude call failed", err);
    return { ok: false, error: describeAnthropicError(err) };
  }

  const parsed = parseJsonResponse(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const incoming = parsed.value.tags.filter((t) => !lockedAxes.has(t.axis));

  let writtenCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const tag of incoming) {
      const upserted = await tx.productTag.upsert({
        where: {
          productId_axis_value: {
            productId: params.product.id,
            axis: tag.axis,
            value: tag.value,
          },
        },
        create: {
          productId: params.product.id,
          shopDomain: params.shopDomain,
          axis: tag.axis,
          value: tag.value,
          source: "AI",
          confidence: tag.confidence ?? null,
          locked: false,
        },
        update: {
          source: "AI",
          confidence: tag.confidence ?? null,
          // don't clobber locked=true if somehow already locked
        },
      });

      await tx.productTagAudit.create({
        data: {
          productId: params.product.id,
          shopDomain: params.shopDomain,
          axis: tag.axis,
          action: "ADD",
          previousValue: null,
          newValue: tag.value,
          source: "AI",
          actorId: params.actorId ?? null,
        },
      });

      if (upserted.id) writtenCount += 1;
    }
  });

  return {
    ok: true,
    tags: incoming,
    writtenCount,
  };
}

// --- helpers -------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonResponse(
  raw: string,
): { ok: true; value: z.infer<typeof TagResponseSchema> } | { ok: false; error: string } {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fenceMatch ? fenceMatch[1] : trimmed;
  try {
    const json = JSON.parse(body) as unknown;
    const result = TagResponseSchema.safeParse(json);
    if (!result.success) {
      return {
        ok: false,
        error: `Claude response did not match schema: ${result.error.message}`,
      };
    }
    return { ok: true, value: result.data };
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse Claude JSON response: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach Anthropic.";
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return "Rate limited by Anthropic.";
    if (err.status === 401 || err.status === 403) {
      return "Anthropic authentication failed.";
    }
    return `Anthropic request failed (status ${err.status ?? "unknown"}).`;
  }
  return "Unexpected error calling Claude.";
}

// Used by the batch route.
export async function generateTagsForProductById(params: {
  shopDomain: string;
  productId: string;
  actorId?: string | null;
}): Promise<GenerateResult> {
  const product = await prisma.product.findFirst({
    where: {
      id: params.productId,
      shopDomain: params.shopDomain,
      deletedAt: null,
    },
    include: { tags: true },
  });
  if (!product) {
    return { ok: false, error: "Product not found." };
  }
  const config = await prisma.merchantConfig.findUnique({
    where: { shop: params.shopDomain },
    select: { storeMode: true },
  });
  return generateTagsForProduct({
    shopDomain: params.shopDomain,
    product,
    storeMode: (config?.storeMode ?? null) as StoreMode | null,
    actorId: params.actorId ?? null,
  });
}

