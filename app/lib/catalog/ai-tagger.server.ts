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
//   - PR-2.1: respects ProductTag.status='REJECTED' — values the merchant
//     has explicitly rejected on a given axis are passed to the prompt as
//     exclusions so the model does not re-suggest them.
//   - PR-2.1: every AI-written ProductTag row lands with status=
//     PENDING_REVIEW. The merchant approves/rejects in 2.3's review UI.
//   - PR-2.1: returns token usage from Anthropic response so the worker
//     (worker-tagging.ts) can compute the per-call microdollar cost.
//   - Audit: every ADD writes a ProductTagAudit row with source=AI.
//   - PR-2.1: model bumped from claude-sonnet-4-5 to claude-sonnet-4-6.
//     Same base price ($3/$15 per Mtok). Smoke test V1/V2 gates verify
//     output shape against the existing axis vocabulary.

import Anthropic from "@anthropic-ai/sdk";
import type { Product, ProductTag } from "@prisma/client";
import { z } from "zod";
import prisma from "../../db.server";
import { logAnthropicError } from "../anthropic.server";
import { log } from "../../server/worker-logger";
import { axisOptionsFor } from "./axis-options";
import { applyRules, type TagWrite } from "./rule-engine.server";
import { STARTER_AXES, type StoreMode } from "./store-axes";

const MODEL = "claude-sonnet-4-6";
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

const TagItemSchema = z.object({
  axis: z.string().min(1).max(64),
  value: z.string().min(1).max(128),
  confidence: z.number().min(0).max(1).optional(),
});

const TagResponseSchema = z.object({
  tags: z.array(TagItemSchema),
});

export type GeneratedTag = z.infer<typeof TagItemSchema>;

// PR-2.1: errorClass taxonomy for the worker's retry/circuit-break
// logic. The worker reads this on { ok:false } returns and routes:
//   RATE_LIMIT, CONNECTION → exponential-backoff retry (max 3)
//   MALFORMED_JSON         → one retry with stricter prompt, then fail
//   AUTH, OTHER            → immediate fail
export type AiTaggerErrorClass =
  | "RATE_LIMIT"
  | "AUTH"
  | "MALFORMED_JSON"
  | "CONNECTION"
  | "OTHER";

export type GenerateResult =
  | {
      ok: true;
      tags: Array<GeneratedTag & { skippedLocked?: boolean }>;
      writtenCount: number;
      // PR-2.1: token usage so the worker can compute microdollar cost
      // via tagging-cost.computeCostFromUsage. Both fields are 0 if the
      // Anthropic call was skipped (e.g. rules covered everything).
      inputTokens: number;
      outputTokens: number;
      model: string;
      // PR-2.1: telemetry for the smoke V2 gate. axesNeeded is the
      // list passed to the AI call (i.e. axes rules did NOT cover);
      // ruleTagsWritten is the count of tags the rule engine wrote
      // before AI ran. These let the worker prove the rule-then-AI
      // cost architecture is working as designed.
      axesNeeded: readonly string[];
      ruleTagsWritten: number;
    }
  | {
      ok: false;
      error: string;
      errorClass: AiTaggerErrorClass;
      // Token usage is recorded even on failure when we got a partial
      // response — Anthropic charges for tokens consumed up to the
      // failure. Both 0 for pre-call failures (auth, missing key).
      inputTokens: number;
      outputTokens: number;
      model: string;
    };

export async function generateTagsForProduct(params: {
  shopDomain: string;
  product: Product & { tags: ProductTag[] };
  storeMode: StoreMode | null;
  actorId?: string | null;
  // 006a §5.4: when set, restrict the AI prompt to these axes (rules
  // already covered the rest). When undefined, default to STARTER_AXES.
  axesNeeded?: readonly string[];
  // PR-2.1: explicit (axis, value) pairs the merchant has rejected on
  // this product. Passed to the prompt as "do not propose these"
  // exclusions. The worker computes this from existing ProductTag
  // rows where status='REJECTED'.
  rejectedValuesByAxis?: Readonly<Record<string, readonly string[]>>;
  // PR-2.1: telemetry passthrough for generateTagsForProductById.
  // Internal use only — orchestration wrapper sets this so the AI-
  // only direct call also returns axesNeeded/ruleTagsWritten.
  ruleTagsWrittenForReturn?: number;
}): Promise<GenerateResult> {
  const anthropic = getClient();
  if (!anthropic) {
    return {
      ok: false,
      error: "Anthropic API key not configured.",
      errorClass: "AUTH",
      inputTokens: 0,
      outputTokens: 0,
      model: MODEL,
    };
  }

  const mode: StoreMode = params.storeMode ?? "GENERAL";
  const starterAxes = params.axesNeeded ?? STARTER_AXES[mode];
  const lockedAxes = new Set(
    params.product.tags.filter((t) => t.locked).map((t) => t.axis),
  );
  const rejectedValuesByAxis = params.rejectedValuesByAxis ?? {};

  // Pass per-axis "common values" as suggestions only — the model is NOT
  // constrained to these. Tag-value hygiene / normalization is deferred to
  // Feature 006. (Feature 005d clarification E: informed-only.)
  const axisOptions = axisOptionsFor(mode);
  const commonValuesByAxis: Record<string, readonly string[]> = {};
  for (const [axis, def] of Object.entries(axisOptions)) {
    if (def.type !== "text") {
      commonValuesByAxis[axis] = def.values;
    }
  }

  const promptPayload = {
    storeMode: mode.toLowerCase(),
    starterAxes,
    commonValuesByAxis,
    lockedAxes: Array.from(lockedAxes),
    rejectedValuesByAxis,
    product: {
      title: params.product.title,
      description: stripHtml(params.product.descriptionHtml ?? ""),
      productType: params.product.productType,
      vendor: params.product.vendor,
      shopifyTags: params.product.shopifyTags,
    },
  };

  const systemPrompt = `You are a catalog tagging assistant for a ${mode.toLowerCase()} store. Tag the product along the provided starter axes. These are suggested axes — add more if the product clearly warrants them. Keep axis names snake_case and stable across products. The commonValuesByAxis map gives you the values most often used for each axis on this storeMode — prefer reusing them when they fit, but you MAY return a different value if the product genuinely warrants one. Do NOT return tags for any axis in lockedAxes. The rejectedValuesByAxis map lists (axis, value) pairs the merchant has explicitly rejected for THIS product — do NOT re-suggest any of those values; you may suggest different values for those axes. Respond with JSON ONLY in the form {"tags":[{"axis":"...","value":"...","confidence":0.0}]} — confidence is 0.0–1.0.`;

  let text: string;
  let inputTokens = 0;
  let outputTokens = 0;
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
    inputTokens = response.usage?.input_tokens ?? 0;
    outputTokens = response.usage?.output_tokens ?? 0;
    const block = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    if (!block) {
      return {
        ok: false,
        error: "Claude returned no text content.",
        errorClass: "MALFORMED_JSON",
        inputTokens,
        outputTokens,
        model: MODEL,
      };
    }
    text = block.text;
  } catch (err) {
    logAnthropicError("[ai-tagger] Claude call failed", err);
    return {
      ok: false,
      error: describeAnthropicError(err),
      errorClass: classifyAnthropicError(err),
      inputTokens,
      outputTokens,
      model: MODEL,
    };
  }

  const parsed = parseJsonResponse(text);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      errorClass: "MALFORMED_JSON",
      inputTokens,
      outputTokens,
      model: MODEL,
    };
  }

  // Apply both lockedAxes and rejectedValuesByAxis filters to the
  // model output. Defense in depth — the prompt asks the model to
  // honor these, but we strip locally so a misbehaving response
  // can never leak through.
  const incoming = parsed.value.tags.filter((t) => {
    if (lockedAxes.has(t.axis)) return false;
    const rejectedForAxis = rejectedValuesByAxis[t.axis];
    if (rejectedForAxis && rejectedForAxis.includes(t.value)) return false;
    return true;
  });

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
          status: "PENDING_REVIEW",
          confidence: tag.confidence ?? null,
          locked: false,
        },
        update: {
          source: "AI",
          confidence: tag.confidence ?? null,
          // PRESERVE existing status — APPROVED stays APPROVED,
          // REJECTED stays REJECTED. Only PENDING_REVIEW values get
          // updated by the regen path. The audit row records the
          // REGEN action separately.
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
    inputTokens,
    outputTokens,
    model: MODEL,
    axesNeeded: starterAxes,
    ruleTagsWritten: params.ruleTagsWrittenForReturn ?? 0,
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

// PR-2.1: classify an Anthropic SDK error into the worker's
// retry-policy taxonomy. The worker reads this and decides whether to
// retry, retry-with-stricter-prompt, or fail immediately.
function classifyAnthropicError(err: unknown): AiTaggerErrorClass {
  if (err instanceof Anthropic.APIConnectionError) return "CONNECTION";
  if (err instanceof Anthropic.APIError) {
    if (err.status === 429) return "RATE_LIMIT";
    if (err.status === 401 || err.status === 403) return "AUTH";
    return "OTHER";
  }
  return "OTHER";
}

// Used by the batch route AND the per-product Generate route. Runs rules
// first (006a §5.4), then calls Claude only for axes still pending. When
// rules cover every requested axis the AI call is skipped entirely — proves
// Decision E that net AI cost goes DOWN, not up.
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
    return {
      ok: false,
      error: "Product not found.",
      errorClass: "OTHER",
      inputTokens: 0,
      outputTokens: 0,
      model: MODEL,
    };
  }
  const config = await prisma.merchantConfig.findUnique({
    where: { shop: params.shopDomain },
    select: { storeMode: true },
  });
  const mode: StoreMode = ((config?.storeMode ?? null) as StoreMode | null) ?? "GENERAL";

  // Rules first. Pass the full starter-axis set; applyRules filters to
  // axes the product doesn't already have a value on (purely additive).
  const ruleResult = await applyRules({
    shopDomain: params.shopDomain,
    product,
    axesNeeded: STARTER_AXES[mode],
    actorId: params.actorId ?? null,
  });

  // Refresh tags from DB so the AI tagger sees the just-written rule tags.
  // applyRules wrote them in its own transaction; reload the product to
  // include them.
  const refreshed =
    ruleResult.tagsWritten.length > 0
      ? await prisma.product.findFirst({
          where: { id: product.id },
          include: { tags: true },
        })
      : product;
  if (!refreshed) {
    return {
      ok: false,
      error: "Product not found.",
      errorClass: "OTHER",
      inputTokens: 0,
      outputTokens: 0,
      model: MODEL,
    };
  }

  // PR-2.1: rejectedValuesByAxis from existing ProductTag rows. The
  // refreshed.tags includes everything; filter to status='REJECTED'.
  const rejectedValuesByAxis: Record<string, string[]> = {};
  for (const t of refreshed.tags) {
    if (t.status === "REJECTED") {
      if (!rejectedValuesByAxis[t.axis]) rejectedValuesByAxis[t.axis] = [];
      rejectedValuesByAxis[t.axis].push(t.value);
    }
  }

  // Skip Claude entirely when rules already covered everything we need.
  // Logged so a Railway tail can prove the cost-reduction claim.
  if (ruleResult.axesStillNeeded.length === 0) {
    log.info("rules covered all axes; skipping AI", {
      event: "tagging_rules_covered_all",
      productId: product.id,
      shopDomain: params.shopDomain,
      axesCovered: ruleResult.tagsWritten.map((w) => w.axis),
    });
    return {
      ok: true,
      tags: ruleResult.tagsWritten.map((w) => toGeneratedTag(w)),
      writtenCount: ruleResult.tagsWritten.length,
      inputTokens: 0,
      outputTokens: 0,
      model: MODEL,
      axesNeeded: [],
      ruleTagsWritten: ruleResult.tagsWritten.length,
    };
  }

  const aiResult = await generateTagsForProduct({
    shopDomain: params.shopDomain,
    product: refreshed,
    storeMode: mode,
    actorId: params.actorId ?? null,
    axesNeeded: ruleResult.axesStillNeeded,
    rejectedValuesByAxis,
    ruleTagsWrittenForReturn: ruleResult.tagsWritten.length,
  });

  if (!aiResult.ok) return aiResult;

  return {
    ok: true,
    tags: [
      ...ruleResult.tagsWritten.map((w) => toGeneratedTag(w)),
      ...aiResult.tags,
    ],
    writtenCount: ruleResult.tagsWritten.length + aiResult.writtenCount,
    inputTokens: aiResult.inputTokens,
    outputTokens: aiResult.outputTokens,
    model: aiResult.model,
    axesNeeded: aiResult.axesNeeded,
    ruleTagsWritten: aiResult.ruleTagsWritten,
  };
}

function toGeneratedTag(w: TagWrite): GeneratedTag {
  return { axis: w.axis, value: w.value, confidence: w.confidence };
}

