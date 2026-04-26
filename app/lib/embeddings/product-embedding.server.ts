// Pure helpers that turn a Product (plus its tag relation) into a single
// string we ship to Voyage. No DB access, no API calls — keeping this
// layer pure makes it trivial to unit-test and lets the orchestration
// layer batch many products in memory before any IO happens.
//
// The text format mixes natural-language fields (title, description) with
// a compact `axis:value` rendering of structured tags. voyage-3 handles
// this hybrid well; the storeMode preamble nudges the model toward the
// right semantic neighbourhood when categories overlap (e.g. a "ring" in
// JEWELLERY vs. ELECTRONICS).

import type { StoreMode } from "@prisma/client";

export type ProductForEmbedding = {
  title: string;
  descriptionHtml: string | null;
  productType: string | null;
  vendor: string | null;
  shopifyTags: string[];
  tags: Array<{ axis: string; value: string }>;
};

const MAX_DESCRIPTION_CHARS = 1500;
const MAX_TOTAL_CHARS = 8000;

const STORE_MODE_PREAMBLE: Record<StoreMode, string> = {
  FASHION: "Fashion product.",
  JEWELLERY: "Jewellery product.",
  ELECTRONICS: "Electronics product.",
  FURNITURE: "Furniture product.",
  BEAUTY: "Beauty product.",
  GENERAL: "Product.",
};

export function buildEmbeddingText(
  product: ProductForEmbedding,
  storeMode: StoreMode,
): string {
  const lines: string[] = [];
  lines.push(STORE_MODE_PREAMBLE[storeMode] ?? STORE_MODE_PREAMBLE.GENERAL);
  lines.push(`Title: ${product.title}`);
  if (product.productType) lines.push(`Type: ${product.productType}`);
  if (product.vendor) lines.push(`Brand: ${product.vendor}`);

  if (product.descriptionHtml) {
    const stripped = stripHtml(product.descriptionHtml).slice(
      0,
      MAX_DESCRIPTION_CHARS,
    );
    if (stripped.length > 0) lines.push(`Description: ${stripped}`);
  }

  if (product.shopifyTags.length > 0) {
    lines.push(`Tags: ${product.shopifyTags.join(", ")}`);
  }

  if (product.tags.length > 0) {
    const formatted = product.tags
      .map((t) => `${t.axis}:${t.value}`)
      .join(", ");
    lines.push(`Attributes: ${formatted}`);
  }

  const joined = lines.join("\n");
  return joined.length > MAX_TOTAL_CHARS
    ? joined.slice(0, MAX_TOTAL_CHARS)
    : joined;
}

// v1 HTML stripper: regex-only. Sufficient for Shopify descriptionHtml
// which is well-formed; if we ever start ingesting wild user-pasted HTML
// we can swap in a proper parser without touching the public surface.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
