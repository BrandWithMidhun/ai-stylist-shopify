// Agent orchestrator — converts a user message into an assistant response
// with optional product cards by:
//   1. Loading per-shop merchant config + building a mode-aware system prompt.
//   2. Running an Anthropic Messages tool-call loop (Sonnet 4.5) until either
//      end_turn, MAX_TOOL_CALLS exhaustion, or a hard error.
//   3. Catching all errors and returning a canned-response fallback so the
//      route never sees an exception (graceful degradation per spec §11).
//
// shopDomain isolation: every tool execution receives shopDomain via
// ToolExecutionContext, never via Claude-controlled tool input. See
// search-products.server.ts security note.

import Anthropic from "@anthropic-ai/sdk";
import type { MerchantConfig } from "@prisma/client";
import { logAnthropicError } from "../anthropic.server";
import {
  ensureMerchantConfig,
} from "../merchant-config.server";
import {
  matchResponse,
  type ProductContext,
} from "./canned-responses.server";
import { assertWithinLimits, RateLimitError } from "./cost-guards.server";
import { newMessageId } from "./session.server";
import { getSuggestions } from "./suggestions.server";
import { buildSystemPrompt } from "./prompts.server";
import { buildToolList, executeTool } from "./tools/registry.server";
import type { ProductCard } from "./tools/types";

const MODEL = "claude-sonnet-4-5";
const MAX_OUTPUT_TOKENS = 1024;
const MAX_TOOL_CALLS = 3;

export type WidgetMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentInput = {
  shopDomain: string;
  sessionId: string;
  text: string;
  context: ProductContext;
  history: WidgetMessage[];
  isFirstMessage: boolean;
};

export type AgentOutput = {
  message: {
    id: string;
    role: "assistant";
    content: string;
    timestamp: number;
    products: ProductCard[];
    suggestions: string[];
  };
  debug: {
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    fallback: boolean;
  };
};

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (cachedClient) return cachedClient;
  // eslint-disable-next-line no-undef
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  cachedClient = new Anthropic({ apiKey: key });
  return cachedClient;
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const startedAt = Date.now();

  // Cost guards (entry-only). Throws RateLimitError on shop cap; truncates
  // long input silently.
  const { text: safeText } = assertWithinLimits(
    input.shopDomain,
    input.sessionId,
    input.text,
  );

  const config = await ensureMerchantConfig(input.shopDomain);

  const client = getClient();
  if (!client) {
    return fallback(input, config, "missing_api_key", startedAt);
  }

  const system = buildSystemPrompt(config);
  const tools = buildToolList(config);

  // Convert widget history (text-only) into Anthropic message params.
  // Tool blocks from prior turns are not preserved — the widget only stores
  // assistant text. Spec §8.3 trade-off: Claude has slightly less context
  // about previous tool results across turns, but text usually summarizes
  // products well enough for follow-ups to work.
  const messages: Anthropic.MessageParam[] = input.history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  messages.push({ role: "user", content: safeText });

  const collected: ProductCard[] = [];
  let toolCallCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      tools,
      messages,
    });
    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    while (
      response.stop_reason === "tool_use" &&
      toolCallCount < MAX_TOOL_CALLS
    ) {
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (toolUses.length === 0) break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUses) {
        const result = await executeTool(block.name, block.input, {
          shopDomain: input.shopDomain,
        });
        if (result.products) collected.push(...result.products);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result.data),
          is_error: result.ok === false,
        });
      }

      // Round-trip: append assistant's tool_use turn + our tool_result turn,
      // then re-call. Claude continues until stop_reason becomes 'end_turn'.
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      toolCallCount += 1;
      response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        tools,
        messages,
      });
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const products = dedupeProducts(collected);
    const durationMs = Date.now() - startedAt;

    // eslint-disable-next-line no-undef, no-console
    console.log("[chat:agent]", {
      shop: input.shopDomain,
      session: input.sessionId,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      durationMs,
      toolCalls: toolCallCount,
      productsReturned: products.length,
    });

    return {
      message: {
        id: newMessageId(),
        role: "assistant",
        content: text || fallbackTextForEmptyResponse(input, config),
        timestamp: Date.now(),
        products,
        suggestions: getSuggestions(config, {
          isFirstMessage: input.isFirstMessage,
          hadProducts: toolCallCount > 0,
          productCount: products.length,
        }),
      },
      debug: {
        toolCalls: toolCallCount,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
        fallback: false,
      },
    };
  } catch (err) {
    if (err instanceof RateLimitError) throw err; // route maps to 429/503
    logAnthropicError("[chat:agent] runAgent failed", err);
    const isApiError =
      err instanceof Anthropic.APIError ||
      err instanceof Anthropic.APIConnectionError;
    return fallback(
      input,
      config,
      isApiError ? "api_error" : "tool_error",
      startedAt,
    );
  }
}

function dedupeProducts(items: ProductCard[]): ProductCard[] {
  const seen = new Set<string>();
  const out: ProductCard[] = [];
  for (const p of items) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function fallbackTextForEmptyResponse(
  input: AgentInput,
  config: MerchantConfig,
): string {
  // Claude can in rare cases stop with stop_reason='end_turn' but no text
  // blocks. Fall back to canned response so the widget never shows a blank
  // bubble.
  const canned = matchResponse({
    text: input.text,
    context: input.context,
    isFirstMessage: input.isFirstMessage,
  });
  void config;
  return canned.content;
}

function fallback(
  input: AgentInput,
  config: MerchantConfig,
  reason: "api_error" | "tool_error" | "missing_api_key",
  startedAt: number,
): AgentOutput {
  const canned = matchResponse({
    text: input.text,
    context: input.context,
    isFirstMessage: input.isFirstMessage,
  });
  // For API-side failures, swap in the spec §8.1 message; for tool errors
  // and missing-key (dev) keep the canned response — it's still useful.
  const content =
    reason === "api_error"
      ? "I'm having trouble right now — please try again in a moment."
      : canned.content;

  return {
    message: {
      id: newMessageId(),
      role: "assistant",
      content,
      timestamp: Date.now(),
      products: [],
      suggestions: getSuggestions(config, {
        isFirstMessage: input.isFirstMessage,
        hadProducts: false,
        productCount: 0,
      }),
    },
    debug: {
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startedAt,
      fallback: true,
    },
  };
}
