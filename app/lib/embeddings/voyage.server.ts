// Thin wrapper around the Voyage AI embeddings endpoint.
//
// Two public surfaces by design:
//   - embedTexts:  documents (input_type="document") — used by the catalog
//                  embedding pipeline (12b) at index time.
//   - embedQuery:  user queries (input_type="query") — used by the
//                  recommend_products tool (12c) at retrieval time.
//
// voyage-3 applies different transformations to documents vs queries; mixing
// the two would silently degrade retrieval quality. Keeping the surfaces
// separate (rather than passing input_type as an argument) means callers
// can't accidentally cross the streams, and we can evolve the document and
// query paths independently as the recommendation layer matures.
//
// Cost discipline: we retry exactly once on 429 (after a 2s pause) and
// never on success. Voyage 5xx and unexpected non-2xx responses bubble up
// so callers can log + handle the failure without aborting larger work.

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = "voyage-3";
const MAX_INPUTS_PER_REQUEST = 128;
const RATE_LIMIT_RETRY_DELAY_MS = 2000;

type InputType = "document" | "query";

let cachedKey: string | null = null;

function getApiKey(): string {
  if (cachedKey) return cachedKey;
  const key = process.env.VOYAGE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Add it to your environment to call Voyage AI.",
    );
  }
  cachedKey = key;
  return key;
}

type VoyageEmbeddingsResponse = {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage?: { total_tokens?: number };
};

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > MAX_INPUTS_PER_REQUEST) {
    throw new Error(
      `embedTexts received ${texts.length} inputs; Voyage accepts up to ${MAX_INPUTS_PER_REQUEST} per request. Chunk before calling.`,
    );
  }
  return postEmbeddings(texts, "document");
}

// Single-string convenience for the retrieval path. Returns the 1024-dim
// vector directly (callers don't want to unwrap a length-1 array on every
// call site).
export async function embedQuery(text: string): Promise<number[]> {
  const trimmed = text?.trim();
  if (!trimmed) {
    throw new Error("embedQuery requires a non-empty string.");
  }
  const [vector] = await postEmbeddings([trimmed], "query");
  return vector;
}

// PR-3.1-mech.6: single-document embed with token usage exposed.
//
// Used by the RE_EMBED worker handler to record per-call cost on the
// TaggingJob row. Distinct from embedTexts (which throws away the
// usage payload because the catalog backfill aggregates cost via
// total batch size, not per-call) so the existing 12b backfill path
// stays untouched.
//
// Returns tokens=0 if Voyage omits usage from the response — the cost
// helper rounds to 0 micros in that case, which is what the operator
// would expect ("we couldn't measure it, don't bill it").
export async function embedDocumentWithUsage(
  text: string,
): Promise<{ embedding: number[]; tokens: number }> {
  const trimmed = text?.trim();
  if (!trimmed) {
    throw new Error("embedDocumentWithUsage requires a non-empty string.");
  }
  const { embeddings, totalTokens } = await postEmbeddingsWithUsage(
    [trimmed],
    "document",
  );
  return { embedding: embeddings[0], tokens: totalTokens };
}

async function postEmbeddings(
  texts: string[],
  inputType: InputType,
): Promise<number[][]> {
  const { embeddings } = await postEmbeddingsWithUsage(texts, inputType);
  return embeddings;
}

async function postEmbeddingsWithUsage(
  texts: string[],
  inputType: InputType,
): Promise<{ embeddings: number[][]; totalTokens: number }> {
  const key = getApiKey();
  const body = JSON.stringify({
    input: texts,
    model: MODEL,
    input_type: inputType,
  });

  const sendRequest = (): Promise<Response> =>
    fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body,
    });

  let response = await sendRequest();
  if (response.status === 429) {
    await sleep(RATE_LIMIT_RETRY_DELAY_MS);
    response = await sendRequest();
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Voyage embeddings request failed (status ${response.status}): ${errorBody}`,
    );
  }

  const payload = (await response.json()) as VoyageEmbeddingsResponse;
  if (!Array.isArray(payload.data) || payload.data.length !== texts.length) {
    throw new Error(
      `Voyage returned ${payload.data?.length ?? 0} embeddings for ${texts.length} inputs.`,
    );
  }

  // Voyage echoes each item's `index` — sort defensively so the caller can
  // rely on output[i] corresponding to input[i] regardless of server order.
  const embeddings = [...payload.data]
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
  const totalTokens = payload.usage?.total_tokens ?? 0;
  return { embeddings, totalTokens };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
