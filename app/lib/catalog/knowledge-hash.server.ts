// Phase 1 (PR-A): canonical hash of a Product's textual knowledge record.
//
// Phase 3 will compare Product.knowledgeContentHash to embeddingContentHash
// and skip re-embedding when unchanged. Phase 1's job is just to compute
// and persist the hash on every ingestion path (worker, webhooks, cron).
//
// What's IN the hash: the textual fields the embedder consumes — title,
// productType, vendor, descriptionText, shopifyTags, collection handles,
// textual metafields, metaobject refs. Plus storeMode because the
// embedder prefixes that into the input string (changing storeMode on a
// shop is rare but should invalidate every product's embedding cache).
//
// What's OUT of the hash, deliberately:
//   - inventory / variants / prices — change for non-knowledge reasons
//   - imageUrls / featuredImageUrl — image churn ≠ semantic churn
//   - ProductTag rows (AI tags) — Phase 2 generates those *from* the
//     knowledge record; circular dependency
//   - shopifyUpdatedAt / our updatedAt — timestamps drift independently
//   - non-textual metafield types (file_reference without resolution,
//     dimension without unit context, etc.) — too noisy for the hash
//
// The function is pure: same input, same output, no I/O. Sort discipline
// inside the function guarantees that incidental ordering changes from
// Shopify (e.g. metafield list order from a different page) don't
// produce a different hash.

import { createHash } from "node:crypto";
import type { StoreMode } from "@prisma/client";

export type KnowledgeMetafieldInput = {
  namespace: string;
  key: string;
  type: string;
  value: string;
};

export type KnowledgeMetaobjectRefInput = {
  type: string;
  handle: string | null;
};

export type KnowledgeHashInput = {
  storeMode: StoreMode;
  title: string;
  productType: string | null;
  vendor: string | null;
  descriptionText: string | null;
  shopifyTags: string[];
  collectionHandles: string[];
  metafields: KnowledgeMetafieldInput[];
  metaobjectRefs: KnowledgeMetaobjectRefInput[];
};

// Shopify metafield types we treat as textual signal. The full list is
// long; keep this conservative (text + structured-text + numeric +
// metaobject ref). Other types (file_reference, page_reference,
// json with binary, color, etc.) get filtered out — they're either
// non-semantic or too volatile to feed into the embedding text.
const TEXTUAL_METAFIELD_TYPES: ReadonlySet<string> = new Set([
  "single_line_text_field",
  "multi_line_text_field",
  "rich_text_field",
  "number_integer",
  "number_decimal",
  "rating",
  "boolean",
  "date",
  "date_time",
  "json",
  "metaobject_reference",
  "list.metaobject_reference",
  "list.single_line_text_field",
  "list.multi_line_text_field",
  "list.number_integer",
  "list.number_decimal",
  "list.rating",
  "list.date",
  "list.date_time",
]);

export function isTextualMetafieldType(type: string): boolean {
  return TEXTUAL_METAFIELD_TYPES.has(type);
}

// Build the canonical string the hash is computed over. Exposed for tests
// and for debugging — when a re-embed fires unexpectedly, hashing both
// sides and diffing the canonical strings is the fastest way to find
// what changed.
export function buildKnowledgeCanonical(input: KnowledgeHashInput): string {
  const parts: string[] = [];
  parts.push(`storeMode=${input.storeMode}`);
  parts.push(`title=${nullSafe(input.title)}`);
  parts.push(`productType=${nullSafe(input.productType)}`);
  parts.push(`vendor=${nullSafe(input.vendor)}`);
  parts.push(`descriptionText=${nullSafe(input.descriptionText)}`);
  parts.push(`shopifyTags=${[...input.shopifyTags].sort().join(",")}`);
  parts.push(
    `collections=${[...input.collectionHandles].sort().join(",")}`,
  );

  const metafieldLines = input.metafields
    .filter((m) => isTextualMetafieldType(m.type))
    .map((m) => `${m.namespace}.${m.key}|${m.type}=${canonicalizeValue(m.value)}`)
    .sort();
  parts.push(`metafields=\n${metafieldLines.join("\n")}`);

  const metaobjectLines = input.metaobjectRefs
    .map((o) => `${o.type}:${o.handle ?? ""}`)
    .sort();
  parts.push(`metaobjects=${metaobjectLines.join(",")}`);

  return parts.join("\n");
}

export function hashKnowledge(input: KnowledgeHashInput): string {
  return createHash("sha256")
    .update(buildKnowledgeCanonical(input), "utf8")
    .digest("hex");
}

function nullSafe(s: string | null | undefined): string {
  return s ?? "";
}

// Whitespace-collapse so that a Shopify-side "save with no real change"
// (which sometimes adds a trailing newline) doesn't bump the hash. This
// is conservative — significant whitespace inside a value gets folded
// to single spaces, which is fine for embedding text.
function canonicalizeValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
