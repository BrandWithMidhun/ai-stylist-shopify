import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.7;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  // eslint-disable-next-line no-undef
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  client = new Anthropic({ apiKey: key });
  return client;
}

export type CallClaudeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function callClaude(
  prompt: string,
  options?: { maxTokens?: number; temperature?: number },
): Promise<CallClaudeResult> {
  const trimmed = prompt?.trim();
  if (!trimmed) {
    return { ok: false, error: "Prompt is required." };
  }

  const anthropic = getClient();
  if (!anthropic) {
    return { ok: false, error: "Anthropic API key not configured." };
  }

  try {
    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature ?? DEFAULT_TEMPERATURE,
      messages: [{ role: "user", content: trimmed }],
    });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    if (!textBlock) {
      return { ok: false, error: "Claude returned no text content." };
    }
    return { ok: true, text: textBlock.text };
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
}

function mapError(err: unknown): string {
  logAnthropicError("[anthropic] callClaude failed", err);

  if (err instanceof Anthropic.APIConnectionError) {
    return "Could not reach Anthropic. Check your network and try again.";
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (status === 401 || status === 403) {
      return "Anthropic authentication failed. Check ANTHROPIC_API_KEY.";
    }
    if (status === 429) {
      return "Rate limited by Anthropic. Please try again in a moment.";
    }
    if (status === 400 || status === 422) {
      return "Invalid request sent to Claude.";
    }
    if (typeof status === "number" && status >= 500) {
      return "Claude is temporarily unavailable. Please try again.";
    }
    return `Claude request failed (status ${status ?? "unknown"}).`;
  }
  return "Unexpected error calling Claude.";
}

// Structured logger for Anthropic SDK errors. Surfaces status/type/message and
// request_id (when present) on dedicated console.error lines so they're
// trivially greppable in Railway runtime logs without leaking to the UI.
export function logAnthropicError(label: string, err: unknown): void {
  const fields: Record<string, unknown> = {};
  if (err instanceof Anthropic.APIError) {
    fields.kind = err.constructor.name;
    fields.status = err.status;
    fields.type = (err as { type?: unknown }).type;
    fields.message = err.message;
    const requestId = (err as { requestID?: unknown; request_id?: unknown })
      .requestID ?? (err as { request_id?: unknown }).request_id;
    if (requestId) fields.requestId = requestId;
    const errorBody = (err as { error?: unknown }).error;
    if (errorBody) fields.body = errorBody;
  } else if (err instanceof Error) {
    fields.kind = err.constructor.name;
    fields.message = err.message;
  } else {
    fields.kind = "unknown";
    fields.value = err;
  }
  // eslint-disable-next-line no-undef, no-console
  console.error(label, fields);
  // eslint-disable-next-line no-undef, no-console
  console.error(label, "raw:", err);
}
