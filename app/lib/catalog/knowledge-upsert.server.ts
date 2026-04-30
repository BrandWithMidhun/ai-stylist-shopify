// Phase 1 (PR-A → PR-C.5): write path for the knowledge record AND for
// the full Product column set.
//
// History:
//   PR-A: introduced as a knowledge-only writer (descriptionText,
//         hash, sync timestamps); legacy upsertNormalizedProduct
//         owned title/price/inventory/variants on the webhook path.
//   PR-C: webhook handlers replaced legacy upsert with DELTA enqueue;
//         worker called this function only.
//   PR-C.2.1: reverted to dual-write because this function did not
//             touch title/price/etc.
//   PR-C.5: collapsed. This function is now the sole writer on the
//           DELTA path and writes BOTH knowledge fields AND legacy
//           Product columns (and reconciles ProductVariant). The
//           webhook handlers thinned to HMAC + DELTA enqueue; the
//           legacy upsertNormalizedProduct stays defined for any
//           future caller (PR-D cron may use it).
//
// Call sites:
//   PR-B worker — bulk INITIAL/MANUAL_RESYNC/DELTA crawl.
//   PR-D cron — drift reconciliation (pending).
//
// Stale-write protection: if Shopify reports an updatedAt older than
// what we already have, we skip the write. Catches the in-flight race
// where two webhooks fire seconds apart and the earlier one's GraphQL
// fetch finishes second.
//
// Hash recompute: hash inputs read from `knowledge.*` (the freshly
// fetched values), not the existing DB row. Pre-C.5 we read title/etc.
// from the row, which produced stale hashes when the legacy upsert was
// removed. The C.2 → C.2.1 → C.5 trail in HANDOFF documents the path.

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
import { deriveInventoryStatus } from "./upsert.server";

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

  // Existing-row probe for stale-write check + previous-hash compare.
  // We will create the row if missing (PR-C.5: this function is now the
  // sole product writer on the DELTA path).
  const existing = await tx.product.findUnique({
    where: {
      shopDomain_shopifyId: {
        shopDomain,
        shopifyId: knowledge.shopifyGid,
      },
    },
    select: {
      id: true,
      shopifyUpdatedAt: true,
      knowledgeContentHash: true,
    },
  });

  if (
    existing?.shopifyUpdatedAt &&
    knowledge.shopifyUpdatedAt < existing.shopifyUpdatedAt
  ) {
    return { productId: existing.id, hashChanged: false, staleSkipped: true };
  }

  // Resolve collection GIDs to local Collection rows up front — the
  // hash needs collection handles, and the ProductCollection
  // reconciliation needs the IDs.
  const knownCollections = await tx.collection.findMany({
    where: {
      shopDomain,
      shopifyId: { in: knowledge.collectionGids },
    },
    select: { id: true, shopifyId: true, handle: true },
  });
  const knownCollectionIds = knownCollections.map((c) => c.id);

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

  // Hash inputs read from `knowledge.*` (freshly fetched), not the
  // existing row. Pre-C.5 we read from the row, which masked title /
  // tag changes once the legacy upsert was removed.
  const hashInput = {
    storeMode,
    title: knowledge.title,
    productType: knowledge.productType,
    vendor: knowledge.vendor,
    descriptionText: knowledge.descriptionText,
    shopifyTags: knowledge.shopifyTags,
    collectionHandles: knownCollections.map((c) => c.handle),
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
  const hashChanged = (existing?.knowledgeContentHash ?? null) !== newHash;
  const inventoryStatus = deriveInventoryStatus(knowledge.totalInventory);
  const now = new Date();

  // Single Product upsert covering both legacy and knowledge columns.
  const product = await tx.product.upsert({
    where: {
      shopDomain_shopifyId: {
        shopDomain,
        shopifyId: knowledge.shopifyGid,
      },
    },
    create: {
      shopDomain,
      shopifyId: knowledge.shopifyGid,
      handle: knowledge.handle,
      title: knowledge.title,
      descriptionHtml: knowledge.descriptionHtml,
      descriptionText: knowledge.descriptionText,
      productType: knowledge.productType,
      vendor: knowledge.vendor,
      status: knowledge.status,
      featuredImageUrl: knowledge.featuredImageUrl,
      imageUrls: knowledge.imageUrls,
      priceMin: knowledge.priceMin,
      priceMax: knowledge.priceMax,
      currency: knowledge.currency,
      shopifyTags: knowledge.shopifyTags,
      totalInventory: knowledge.totalInventory,
      inventoryStatus,
      shopifyCreatedAt: knowledge.shopifyCreatedAt,
      shopifyUpdatedAt: knowledge.shopifyUpdatedAt,
      syncedAt: now,
      knowledgeContentHash: newHash,
      knowledgeContentHashAt: now,
      lastKnowledgeSyncAt: now,
      deletedAt: null,
    },
    update: {
      handle: knowledge.handle,
      title: knowledge.title,
      descriptionHtml: knowledge.descriptionHtml,
      descriptionText: knowledge.descriptionText,
      productType: knowledge.productType,
      vendor: knowledge.vendor,
      status: knowledge.status,
      featuredImageUrl: knowledge.featuredImageUrl,
      imageUrls: knowledge.imageUrls,
      priceMin: knowledge.priceMin,
      priceMax: knowledge.priceMax,
      currency: knowledge.currency,
      shopifyTags: knowledge.shopifyTags,
      totalInventory: knowledge.totalInventory,
      inventoryStatus,
      shopifyCreatedAt: knowledge.shopifyCreatedAt,
      shopifyUpdatedAt: knowledge.shopifyUpdatedAt,
      syncedAt: now,
      knowledgeContentHash: newHash,
      knowledgeContentHashAt: now,
      lastKnowledgeSyncAt: now,
      deletedAt: null,
    },
  });

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
        syncedAt: now,
      },
      update: {
        type: m.type,
        value: m.value,
        referenceGid: m.referenceGid,
        shopifyMetafieldId: m.shopifyMetafieldId,
        shopifyUpdatedAt: m.shopifyUpdatedAt,
        syncedAt: now,
      },
    });
  }

  // Reconcile ProductCollection memberships. Skip GIDs we don't have
  // local Collection rows for — the Collections phase / collections/*
  // webhooks fill them.
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

  // Reconcile ProductVariant rows. Same pattern as the legacy path:
  // deleteMany variants no longer present in the fetched payload, then
  // per-variant upsert. Mirror of upsert.server.ts:262-307.
  const incomingVariantGids = knowledge.variants.map((v) => v.shopifyGid);
  await tx.productVariant.deleteMany({
    where: {
      productId: product.id,
      shopifyId: { notIn: incomingVariantGids.length ? incomingVariantGids : ["__none__"] },
    },
  });

  for (const v of knowledge.variants) {
    await tx.productVariant.upsert({
      where: {
        productId_shopifyId: {
          productId: product.id,
          shopifyId: v.shopifyGid,
        },
      },
      create: {
        productId: product.id,
        shopifyId: v.shopifyGid,
        title: v.title,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        inventoryQuantity: v.inventoryQuantity,
        inventoryItemId: v.inventoryItemId,
        availableForSale: v.availableForSale,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        imageUrl: v.imageUrl,
      },
      update: {
        title: v.title,
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        inventoryQuantity: v.inventoryQuantity,
        inventoryItemId: v.inventoryItemId,
        availableForSale: v.availableForSale,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        imageUrl: v.imageUrl,
      },
    });
  }

  // Reference assertion to silence the unused-set warning; the Set is
  // kept for clarity in the deleteMany filter above.
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
