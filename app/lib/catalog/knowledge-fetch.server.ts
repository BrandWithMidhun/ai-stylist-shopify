// Phase 1 (PR-A): pure parsers from Shopify GraphQL responses to
// the normalized shapes that knowledge-upsert.server.ts writes to DB.
//
// What's NOT here: the actual `admin.graphql(...)` calls. Those live
// in PR-B's worker, PR-C's webhook handlers, and PR-D's cron — each
// has its own auth context (offline session vs. webhook session vs.
// unauthenticated). Keeping the parsers pure means all three call
// sites can reuse them.
//
// HTML stripper: same approach as buildEmbeddingText today (regex).
// Sufficient for Shopify's well-formed descriptionHtml; if we ever need
// to handle wild user-pasted HTML we can swap in a real parser without
// changing the public surface.

import type {
  GqlCollection,
  GqlKnowledgeProduct,
  GqlMetaobject,
  GqlReference,
} from "./queries/knowledge.server";
import { isSmartCollection } from "./queries/knowledge.server";

// --- Normalized shapes ---------------------------------------------------

export type NormalizedKnowledgeMetafield = {
  shopifyMetafieldId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
  referenceGid: string | null;
  shopifyUpdatedAt: Date | null;
};

export type NormalizedKnowledgeCollection = {
  shopifyGid: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  descriptionText: string | null;
  sortOrder: string | null;
  templateSuffix: string | null;
  isSmart: boolean;
  shopifyUpdatedAt: Date | null;
};

export type NormalizedKnowledgeMetaobject = {
  shopifyGid: string;
  type: string;
  handle: string | null;
  displayName: string | null;
  fields: Record<
    string,
    { type: string; value: string; referenceGid: string | null }
  >;
  shopifyUpdatedAt: Date | null;
};

export type NormalizedKnowledgeVariant = {
  shopifyGid: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryItemId: string | null;
  availableForSale: boolean;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  imageUrl: string | null;
};

// What the upsert path needs to write a Product's knowledge record. The
// caller (worker / webhook / cron) is responsible for ensuring all
// metafield pages have been collected before calling — paging happens
// in the call-site loop, not here.
//
// PR-C.5: extended to carry the full Product column set. Pre-C.5 this
// type only held knowledge fields and the legacy webhook upsert wrote
// the rest; post-C.5 the worker is the single authoritative writer.
export type NormalizedProductKnowledge = {
  shopifyGid: string;
  handle: string;
  title: string;
  descriptionHtml: string | null;
  descriptionText: string | null;
  productType: string | null;
  vendor: string | null;
  status: string;
  shopifyTags: string[];
  featuredImageUrl: string | null;
  imageUrls: string[];
  priceMin: string | null;
  priceMax: string | null;
  currency: string | null;
  totalInventory: number | null;
  shopifyCreatedAt: Date;
  shopifyUpdatedAt: Date;
  variants: NormalizedKnowledgeVariant[];
  metafields: NormalizedKnowledgeMetafield[];
  // Collection memberships referenced by this product. Just the GIDs;
  // the upsert path resolves them to local Collection rows.
  collectionGids: string[];
};

// --- Parsers --------------------------------------------------------------

export function normalizeKnowledgeProduct(
  p: GqlKnowledgeProduct,
  // Additional metafield pages the caller paged through after the
  // initial response, in original order. Empty if the first page was
  // sufficient.
  extraMetafieldPages: GqlKnowledgeProduct["metafields"]["nodes"][] = [],
): NormalizedProductKnowledge {
  const allMetafieldNodes = [
    ...p.metafields.nodes,
    ...extraMetafieldPages.flat(),
  ];
  const descriptionText = stripHtml(p.descriptionHtml);
  const imageUrls = p.images.nodes.map((n) => n.url).slice(0, 20);
  return {
    shopifyGid: p.id,
    handle: p.handle,
    title: p.title,
    descriptionHtml: p.descriptionHtml,
    descriptionText,
    productType: p.productType,
    vendor: p.vendor,
    status: p.status,
    shopifyTags: p.tags,
    featuredImageUrl: p.featuredImage?.url ?? imageUrls[0] ?? null,
    imageUrls,
    priceMin: p.priceRangeV2?.minVariantPrice.amount ?? null,
    priceMax: p.priceRangeV2?.maxVariantPrice.amount ?? null,
    currency: p.priceRangeV2?.minVariantPrice.currencyCode ?? null,
    totalInventory: p.totalInventory,
    shopifyCreatedAt: new Date(p.createdAt),
    shopifyUpdatedAt: new Date(p.updatedAt),
    variants: p.variants.nodes.map((v) => ({
      shopifyGid: v.id,
      title: v.title,
      sku: v.sku,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      inventoryQuantity: v.inventoryQuantity,
      inventoryItemId: extractNumericId(v.inventoryItem?.id ?? null),
      availableForSale: v.availableForSale,
      option1: v.selectedOptions[0]?.value ?? null,
      option2: v.selectedOptions[1]?.value ?? null,
      option3: v.selectedOptions[2]?.value ?? null,
      imageUrl: v.image?.url ?? null,
    })),
    metafields: allMetafieldNodes.map(normalizeMetafield),
    collectionGids: p.collections.nodes.map((c) => c.id),
  };
}

function extractNumericId(gid: string | null): string | null {
  if (!gid) return null;
  const parts = gid.split("/");
  return parts[parts.length - 1] || null;
}

export function normalizeMetafield(
  m: GqlKnowledgeProduct["metafields"]["nodes"][number],
): NormalizedKnowledgeMetafield {
  return {
    shopifyMetafieldId: m.id,
    namespace: m.namespace,
    key: m.key,
    type: m.type,
    value: m.value,
    referenceGid: extractReferenceGid(m.reference, m.type, m.value),
    shopifyUpdatedAt: m.updatedAt ? new Date(m.updatedAt) : null,
  };
}

export function normalizeCollection(
  c: GqlCollection,
): NormalizedKnowledgeCollection {
  return {
    shopifyGid: c.id,
    handle: c.handle,
    title: c.title,
    descriptionHtml: c.descriptionHtml,
    descriptionText: stripHtml(c.descriptionHtml),
    sortOrder: c.sortOrder,
    templateSuffix: c.templateSuffix,
    isSmart: isSmartCollection(c),
    shopifyUpdatedAt: new Date(c.updatedAt),
  };
}

export function normalizeMetaobject(
  m: GqlMetaobject,
): NormalizedKnowledgeMetaobject {
  const fields: NormalizedKnowledgeMetaobject["fields"] = {};
  for (const f of m.fields) {
    fields[f.key] = {
      type: f.type,
      value: f.value,
      referenceGid: extractReferenceGid(f.reference, f.type, f.value),
    };
  }
  return {
    shopifyGid: m.id,
    type: m.type,
    handle: m.handle,
    displayName: m.displayName,
    fields,
    shopifyUpdatedAt: new Date(m.updatedAt),
  };
}

// --- Helpers --------------------------------------------------------------

function extractReferenceGid(
  reference: GqlReference | null,
  type: string,
  value: string,
): string | null {
  // For *_reference types, prefer the resolved reference's id; fall back
  // to the raw string value (which IS the GID for unresolved single
  // references). For list.*_reference, the value is a JSON array of
  // GIDs and Shopify doesn't return a single `reference` — we return
  // null and let the caller parse the value when they need to resolve.
  if (reference && "id" in reference) {
    return reference.id;
  }
  if (type.endsWith("_reference") && !type.startsWith("list.")) {
    return value || null;
  }
  return null;
}

export function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : null;
}
