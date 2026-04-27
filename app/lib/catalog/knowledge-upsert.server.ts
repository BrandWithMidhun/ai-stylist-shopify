// Phase 1 (PR-A): write path for the knowledge record.
//
// The shape of this module is shared across all three call sites that
// land in later PRs:
//   PR-B worker         — bulk INITIAL/MANUAL_RESYNC/DELTA crawl
//   PR-C webhook handlers — per-product reconciliation on
//                            products/update etc.
//   PR-D cron           — drift reconciliation for missed webhooks
//
// All three pass NormalizedProductKnowledge (for products) or
// NormalizedKnowledgeCollection / NormalizedKnowledgeMetaobject. The
// reconciliation pattern is the same as today's variant reconciliation
// in upsert.server.ts: full-set replacement keyed by stable Shopify
// GIDs, idempotent.
//
// Stale-write protection: if Shopify reports an updatedAt older than
// what we already have, we skip the write. Catches the in-flight race
// where two webhooks fire seconds apart and the earlier one's GraphQL
// fetch finishes second.
//
// Hash recompute: every upsertProductKnowledge call recomputes
// knowledgeContentHash from the just-written rich record. This means
// metafield/collection/metaobject changes that flow in via different
// upsert paths still produce a fresh hash — the cross-table
// invalidation refinement (#4) holds.

import type { Prisma, StoreMode } from "@prisma/client";
import prisma from "../../db.server";
import {
  hashKnowledge,
  type KnowledgeMetafieldInput,
  type KnowledgeMetaobjectRefInput,
} from "./knowledge-hash.server";
import type {
  NormalizedKnowledgeCollection,
  NormalizedKnowledgeMetafield,
  NormalizedKnowledgeMetaobject,
  NormalizedProductKnowledge,
} from "./knowledge-fetch.server";

export type UpsertProductKnowledgeResult = {
  productId: string | null; // null if Product not found locally (skipped)
  hashChanged: boolean;
  staleSkipped: boolean;
};

// Upsert all rich knowledge for a single product. Caller provides
// shopDomain + storeMode (we read storeMode from MerchantConfig in the
// caller for efficiency rather than re-fetching here; pass it in).
//
// The function is wrapped in a transaction by the caller when batching;
// we accept an optional Prisma TransactionClient to nest inside an
// outer transaction.
export async function upsertProductKnowledge(params: {
  shopDomain: string;
  storeMode: StoreMode;
  knowledge: NormalizedProductKnowledge;
  tx?: Prisma.TransactionClient;
}): Promise<UpsertProductKnowledgeResult> {
  const { shopDomain, storeMode, knowledge } = params;
  const tx = params.tx ?? prisma;

  // Find the existing Product row. We don't create here — the legacy
  // upsert path (upsert.server.ts) owns Product row creation from the
  // products/* webhook + sync flows. If the row doesn't exist locally
  // yet (e.g. webhook arrived before initial sync wrote it), we skip
  // and let the caller decide whether to retry later.
  const product = await tx.product.findUnique({
    where: {
      shopDomain_shopifyId: {
        shopDomain,
        shopifyId: knowledge.shopifyGid,
      },
    },
    select: {
      id: true,
      shopifyUpdatedAt: true,
      title: true,
      productType: true,
      vendor: true,
      shopifyTags: true,
      knowledgeContentHash: true,
    },
  });

  if (!product) {
    return { productId: null, hashChanged: false, staleSkipped: false };
  }

  // Stale-write protection — see the file header.
  if (
    product.shopifyUpdatedAt &&
    knowledge.shopifyUpdatedAt < product.shopifyUpdatedAt
  ) {
    return { productId: product.id, hashChanged: false, staleSkipped: true };
  }

  // Reconcile ProductMetafield rows. Full-set replacement keyed on
  // (productId, namespace, key) which is the unique constraint.
  const incomingMetafieldKeys = new Set(
    knowledge.metafields.map((m) => keyForMetafield(m)),
  );

  await tx.productMetafield.deleteMany({
    where: {
      productId: product.id,
      NOT: {
        OR: knowledge.metafields.length
          ? knowledge.metafields.map((m) => ({
              namespace: m.namespace,
              key: m.key,
            }))
          : [{ namespace: "__none__", key: "__none__" }],
      },
    },
  });

  for (const m of knowledge.metafields) {
    await tx.productMetafield.upsert({
      where: {
        productId_namespace_key: {
          productId: product.id,
          namespace: m.namespace,
          key: m.key,
        },
      },
      create: {
        productId: product.id,
        shopDomain,
        namespace: m.namespace,
        key: m.key,
        type: m.type,
        value: m.value,
        referenceGid: m.referenceGid,
        shopifyMetafieldId: m.shopifyMetafieldId,
        shopifyUpdatedAt: m.shopifyUpdatedAt,
        syncedAt: new Date(),
      },
      update: {
        type: m.type,
        value: m.value,
        referenceGid: m.referenceGid,
        shopifyMetafieldId: m.shopifyMetafieldId,
        shopifyUpdatedAt: m.shopifyUpdatedAt,
        syncedAt: new Date(),
      },
    });
  }

  // Reconcile ProductCollection memberships. Resolve each incoming GID
  // to a local Collection.id; skip any GIDs we don't yet have rows for
  // (the Collections phase / collections/update webhook will fill them).
  const knownCollections = await tx.collection.findMany({
    where: {
      shopDomain,
      shopifyId: { in: knowledge.collectionGids },
    },
    select: { id: true, shopifyId: true },
  });
  const knownCollectionIds = knownCollections.map((c) => c.id);

  await tx.productCollection.deleteMany({
    where: {
      productId: product.id,
      ...(knownCollectionIds.length
        ? { collectionId: { notIn: knownCollectionIds } }
        : {}),
    },
  });

  for (const c of knownCollections) {
    await tx.productCollection.upsert({
      where: {
        productId_collectionId: {
          productId: product.id,
          collectionId: c.id,
        },
      },
      create: {
        productId: product.id,
        collectionId: c.id,
        shopDomain,
      },
      update: {},
    });
  }

  // Compute hash inputs from the just-written state plus the row we
  // already loaded. We re-read metafields and collections here rather
  // than reusing `knowledge` directly because the hash should reflect
  // what's actually in the DB after reconciliation (handles late-
  // arriving collection rows correctly).
  const collectionRows = await tx.collection.findMany({
    where: {
      id: { in: knownCollectionIds },
    },
    select: { handle: true },
  });

  // Resolve metaobject handles for any metafield reference that points
  // at a Metaobject we know. Phase 1 doesn't deeply resolve list.* refs;
  // single metaobject_reference is the common case and is enough for
  // the cross-table invalidation invariant.
  const metaobjectRefGids = knowledge.metafields
    .map((m) => m.referenceGid)
    .filter((g): g is string => g !== null && g.includes("/Metaobject/"));
  const metaobjectRows = metaobjectRefGids.length
    ? await tx.metaobject.findMany({
        where: {
          shopDomain,
          shopifyId: { in: metaobjectRefGids },
        },
        select: { type: true, handle: true },
      })
    : [];

  const hashInput = {
    storeMode,
    title: product.title,
    productType: product.productType,
    vendor: product.vendor,
    descriptionText: knowledge.descriptionText,
    shopifyTags: product.shopifyTags,
    collectionHandles: collectionRows.map((c) => c.handle),
    metafields: knowledge.metafields.map<KnowledgeMetafieldInput>((m) => ({
      namespace: m.namespace,
      key: m.key,
      type: m.type,
      value: m.value,
    })),
    metaobjectRefs: metaobjectRows.map<KnowledgeMetaobjectRefInput>((o) => ({
      type: o.type,
      handle: o.handle,
    })),
  };

  const newHash = hashKnowledge(hashInput);
  const hashChanged = product.knowledgeContentHash !== newHash;

  await tx.product.update({
    where: { id: product.id },
    data: {
      descriptionHtml: knowledge.descriptionHtml,
      descriptionText: knowledge.descriptionText,
      knowledgeContentHash: newHash,
      knowledgeContentHashAt: new Date(),
      lastKnowledgeSyncAt: new Date(),
      shopifyUpdatedAt: knowledge.shopifyUpdatedAt,
    },
  });

  // Reference assertion to silence the unused-import warning for
  // metafields keyset; Set is built so deleteMany above can use it.
  void incomingMetafieldKeys;

  return { productId: product.id, hashChanged, staleSkipped: false };
}

export async function upsertCollection(params: {
  shopDomain: string;
  collection: NormalizedKnowledgeCollection;
  tx?: Prisma.TransactionClient;
}): Promise<{ collectionId: string }> {
  const { shopDomain, collection } = params;
  const tx = params.tx ?? prisma;
  const row = await tx.collection.upsert({
    where: {
      shopDomain_shopifyId: {
        shopDomain,
        shopifyId: collection.shopifyGid,
      },
    },
    create: {
      shopDomain,
      shopifyId: collection.shopifyGid,
      handle: collection.handle,
      title: collection.title,
      descriptionHtml: collection.descriptionHtml,
      descriptionText: collection.descriptionText,
      sortOrder: collection.sortOrder,
      templateSuffix: collection.templateSuffix,
      isSmart: collection.isSmart,
      shopifyUpdatedAt: collection.shopifyUpdatedAt,
      syncedAt: new Date(),
    },
    update: {
      handle: collection.handle,
      title: collection.title,
      descriptionHtml: collection.descriptionHtml,
      descriptionText: collection.descriptionText,
      sortOrder: collection.sortOrder,
      templateSuffix: collection.templateSuffix,
      isSmart: collection.isSmart,
      shopifyUpdatedAt: collection.shopifyUpdatedAt,
      syncedAt: new Date(),
    },
  });
  return { collectionId: row.id };
}

export async function deleteCollection(params: {
  shopDomain: string;
  shopifyGid: string;
  tx?: Prisma.TransactionClient;
}): Promise<{ deleted: boolean }> {
  const { shopDomain, shopifyGid } = params;
  const tx = params.tx ?? prisma;
  const result = await tx.collection.deleteMany({
    where: { shopDomain, shopifyId: shopifyGid },
  });
  return { deleted: result.count > 0 };
}

export async function upsertMetaobject(params: {
  shopDomain: string;
  metaobject: NormalizedKnowledgeMetaobject;
  tx?: Prisma.TransactionClient;
}): Promise<{ metaobjectId: string }> {
  const { shopDomain, metaobject } = params;
  const tx = params.tx ?? prisma;
  const row = await tx.metaobject.upsert({
    where: {
      shopDomain_shopifyId: {
        shopDomain,
        shopifyId: metaobject.shopifyGid,
      },
    },
    create: {
      shopDomain,
      shopifyId: metaobject.shopifyGid,
      type: metaobject.type,
      handle: metaobject.handle,
      displayName: metaobject.displayName,
      fields: metaobject.fields as unknown as Prisma.InputJsonValue,
      shopifyUpdatedAt: metaobject.shopifyUpdatedAt,
      syncedAt: new Date(),
    },
    update: {
      type: metaobject.type,
      handle: metaobject.handle,
      displayName: metaobject.displayName,
      fields: metaobject.fields as unknown as Prisma.InputJsonValue,
      shopifyUpdatedAt: metaobject.shopifyUpdatedAt,
      syncedAt: new Date(),
    },
  });
  return { metaobjectId: row.id };
}

export async function deleteMetaobject(params: {
  shopDomain: string;
  shopifyGid: string;
  tx?: Prisma.TransactionClient;
}): Promise<{ deleted: boolean }> {
  const { shopDomain, shopifyGid } = params;
  const tx = params.tx ?? prisma;
  const result = await tx.metaobject.deleteMany({
    where: { shopDomain, shopifyId: shopifyGid },
  });
  return { deleted: result.count > 0 };
}

// Bump the knowledgeContentHash for every product that currently
// references the given metaobject GID via a metafield. Used by the
// metaobjects/update webhook (PR-C) to fan out invalidation. Returns
// the count of products affected.
export async function bumpHashForMetaobjectReferents(params: {
  shopDomain: string;
  metaobjectGid: string;
  tx?: Prisma.TransactionClient;
}): Promise<{ affectedProductIds: string[] }> {
  const { shopDomain, metaobjectGid } = params;
  const tx = params.tx ?? prisma;
  const referents = await tx.productMetafield.findMany({
    where: { shopDomain, referenceGid: metaobjectGid },
    select: { productId: true },
    distinct: ["productId"],
  });
  // Mark the products as needing a hash recompute. PR-C's webhook
  // handler will follow up with a per-product knowledge fetch + upsert
  // which actually recomputes the hash. Setting hash to NULL is the
  // explicit "stale" signal Phase 3's re-embed path will key off of.
  const ids = referents.map((r) => r.productId);
  if (ids.length > 0) {
    await tx.product.updateMany({
      where: { id: { in: ids } },
      data: { knowledgeContentHash: null, knowledgeContentHashAt: null },
    });
  }
  return { affectedProductIds: ids };
}

function keyForMetafield(m: NormalizedKnowledgeMetafield): string {
  return `${m.namespace} ${m.key}`;
}
