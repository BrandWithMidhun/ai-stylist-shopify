// Per-shop embedding orchestration. Reads candidate products, builds the
// embedding text via the pure helper, batches into 128-input requests
// against Voyage, then writes each 1024-dim vector to the Unsupported
// `vector(1024)` column via raw SQL.
//
// Why $executeRaw: Prisma can't update Unsupported() columns through the
// typed `update` API. The cast `$1::vector` forces Postgres to parse the
// `[a,b,c,...]` literal we send into a pgvector value.
//
// Idempotency: a product is re-embedded only when it has never been
// embedded (embeddingUpdatedAt IS NULL) or has been mutated since its
// last embedding (Product.updatedAt > Product.embeddingUpdatedAt). The
// `force` option bypasses both gates for full re-embeds.
//
// Failure model: a single batch's failure (Voyage 5xx after retry, write
// error, etc.) marks every product in that batch as failed but does NOT
// abort the shop — subsequent batches still get a chance. embedAllShops
// applies the same isolation at the shop boundary.

import type { Prisma, StoreMode } from "@prisma/client";
import prisma from "../../db.server";
import { getMerchantConfig } from "../merchant-config.server";
import { embedTexts } from "./voyage.server";
import {
  buildEmbeddingText,
  type ProductForEmbedding,
} from "./product-embedding.server";

const VOYAGE_BATCH_SIZE = 128;

export type EmbedResult = {
  shopDomain: string;
  processed: number;
  succeeded: number;
  failed: number;
  skippedUpToDate: number;
  durationMs: number;
};

export async function embedProductsForShop(
  shopDomain: string,
  options?: { force?: boolean; limit?: number },
): Promise<EmbedResult> {
  const startedAt = Date.now();
  const result: EmbedResult = {
    shopDomain,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skippedUpToDate: 0,
    durationMs: 0,
  };

  const config = await getMerchantConfig(shopDomain);
  if (!config) {
    // eslint-disable-next-line no-console
    console.warn(
      `[embed-products] no MerchantConfig for ${shopDomain}; skipping shop.`,
    );
    result.durationMs = Date.now() - startedAt;
    return result;
  }
  const storeMode = config.storeMode as StoreMode;
  const force = options?.force === true;

  const baseWhere: Prisma.ProductWhereInput = {
    shopDomain,
    status: "ACTIVE",
    deletedAt: null,
    recommendationExcluded: false,
  };

  // Field-reference comparison: re-embed if Product.updatedAt is newer
  // than Product.embeddingUpdatedAt. Null embeddingUpdatedAt fails the
  // gt comparison in SQL, so we OR it in explicitly to catch never-
  // embedded rows.
  const where: Prisma.ProductWhereInput = force
    ? baseWhere
    : {
        ...baseWhere,
        OR: [
          { embeddingUpdatedAt: null },
          {
            updatedAt: { gt: prisma.product.fields.embeddingUpdatedAt },
          },
        ],
      };

  const totalActive = await prisma.product.count({ where: baseWhere });

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      title: true,
      descriptionHtml: true,
      productType: true,
      vendor: true,
      shopifyTags: true,
      tags: { select: { axis: true, value: true } },
    },
    ...(typeof options?.limit === "number" ? { take: options.limit } : {}),
  });

  result.processed = products.length;
  result.skippedUpToDate = force
    ? 0
    : Math.max(0, totalActive - products.length);

  const items = products.map((p) => ({
    id: p.id,
    text: buildEmbeddingText(p as ProductForEmbedding, storeMode),
  }));

  for (let i = 0; i < items.length; i += VOYAGE_BATCH_SIZE) {
    const batch = items.slice(i, i + VOYAGE_BATCH_SIZE);
    const batchIndex = Math.floor(i / VOYAGE_BATCH_SIZE);
    const batchStart = Date.now();
    try {
      const vectors = await embedTexts(batch.map((b) => b.text));
      for (let j = 0; j < batch.length; j++) {
        await writeEmbedding(batch[j].id, vectors[j]);
        result.succeeded += 1;
      }
      // eslint-disable-next-line no-console
      console.log("[embed-products]", {
        shop: shopDomain,
        batchIndex,
        batchSize: batch.length,
        durationMs: Date.now() - batchStart,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[embed-products] batch ${batchIndex} failed for ${shopDomain}:`,
        err,
      );
      result.failed += batch.length;
    }
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

export async function embedAllShops(
  options?: { force?: boolean },
): Promise<EmbedResult[]> {
  const shops = await prisma.product.findMany({
    distinct: ["shopDomain"],
    select: { shopDomain: true },
  });

  const results: EmbedResult[] = [];
  for (const { shopDomain } of shops) {
    try {
      results.push(await embedProductsForShop(shopDomain, options));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[embed-products] shop run threw for ${shopDomain}:`,
        err,
      );
      results.push({
        shopDomain,
        processed: 0,
        succeeded: 0,
        failed: 0,
        skippedUpToDate: 0,
        durationMs: 0,
      });
    }
  }

  const totals = results.reduce(
    (acc, r) => {
      acc.processed += r.processed;
      acc.succeeded += r.succeeded;
      acc.failed += r.failed;
      acc.skippedUpToDate += r.skippedUpToDate;
      return acc;
    },
    { processed: 0, succeeded: 0, failed: 0, skippedUpToDate: 0 },
  );
  // eslint-disable-next-line no-console
  console.log("[embed-products] all shops complete:", {
    shops: shops.length,
    ...totals,
  });

  return results;
}

async function writeEmbedding(
  productId: string,
  vector: number[],
): Promise<void> {
  const formatted = formatVector(vector);
  await prisma.$executeRaw`UPDATE "Product" SET "embedding" = ${formatted}::vector, "embeddingUpdatedAt" = NOW() WHERE id = ${productId}`;
}

function formatVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
