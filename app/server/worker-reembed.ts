// PR-3.1-mech.6: RE_EMBED TaggingJob handler.
//
// Sibling to worker-tagging-backfill.ts. The worker-tagging.ts main loop
// dispatches kind="RE_EMBED" rows to processReEmbedJob, which:
//
//   1. Loads the product (with the relations buildEmbeddingText needs).
//   2. Applies Decision A's skip predicate exactly: skip when
//      embeddingContentHash IS NOT NULL AND === knowledgeContentHash.
//      The job is marked SUCCEEDED with summary.skipped=true; no Voyage
//      call, no cost recorded.
//   3. Otherwise rebuilds the knowledge text via buildEmbeddingText
//      (Phase 12b helper), calls Voyage with input_type="document" via
//      embedDocumentWithUsage, computes cost via voyage-cost.server.ts,
//      and atomically updates Product.embedding +
//      embeddingContentHash + embeddingUpdatedAt in a single SQL
//      statement.
//   4. Records cost on the TaggingJob row (costUsdMicros + inputTokens;
//      Voyage has no separate output token charge so outputTokens is 0).
//
// The bulk pass for the ~1,169 NULL-hash dev-shop rows is NOT enqueued
// here — sub-bundle 3.1.5 owns that trigger. mech.6 only ships the
// handler; verification is one hand-enqueued test job (see
// .pr-3-1-mech-6-artifacts/re-embed-handler-verify.txt).

import type { Prisma, StoreMode, TaggingJob } from "@prisma/client";
import prisma from "../db.server";
import {
  buildEmbeddingText,
  type ProductForEmbedding,
} from "../lib/embeddings/product-embedding.server";
import { embedDocumentWithUsage } from "../lib/embeddings/voyage.server";
import { computeVoyageCost } from "../lib/embeddings/voyage-cost.server";
import {
  finishTaggingJob,
  heartbeatTaggingJob,
  logTaggingFailure,
  updateTaggingProgress,
} from "../lib/catalog/tagging-jobs.server";
import { log } from "./worker-logger";

type ReEmbedSummary = {
  kind: "RE_EMBED";
  outcome: "succeeded" | "skipped" | "failed";
  skipped: boolean;
  reason?: string;
  tokens?: number;
  costMicros?: number;
  durationMs?: number;
};

export type ProcessReEmbedResult =
  | { outcome: "skipped"; tokens: 0; costMicros: 0 }
  | { outcome: "succeeded"; tokens: number; costMicros: number }
  | { outcome: "failed"; tokens: number; costMicros: number; message: string };

export async function processReEmbedJob(params: {
  job: TaggingJob;
}): Promise<ProcessReEmbedResult> {
  const { job } = params;
  const startMs = Date.now();

  if (!job.productId) {
    const message = "TaggingJob.productId is null for RE_EMBED kind";
    log.error("re-embed job has no productId", {
      event: "reembed_job_no_product_id",
      jobId: job.id,
      shopDomain: job.shopDomain,
    });
    await logTaggingFailure({
      jobId: job.id,
      errorClass: "OTHER",
      message,
    });
    await finishTaggingJob(job.id, {
      status: "FAILED",
      errorClass: "OTHER",
      errorMessage: message,
      summary: {
        kind: "RE_EMBED",
        outcome: "failed",
        skipped: false,
        reason: "no_product_id",
      } satisfies ReEmbedSummary as Prisma.InputJsonValue,
    });
    return { outcome: "failed", tokens: 0, costMicros: 0, message };
  }

  await heartbeatTaggingJob(job.id);

  const product = await prisma.product.findFirst({
    where: {
      id: job.productId,
      shopDomain: job.shopDomain,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      descriptionHtml: true,
      productType: true,
      vendor: true,
      shopifyTags: true,
      knowledgeContentHash: true,
      embeddingContentHash: true,
      tags: { select: { axis: true, value: true } },
    },
  });

  if (!product) {
    const message = `Product ${job.productId} not found for RE_EMBED on ${job.shopDomain}`;
    log.error("re-embed product not found", {
      event: "reembed_product_not_found",
      jobId: job.id,
      shopDomain: job.shopDomain,
      productId: job.productId,
    });
    await logTaggingFailure({
      jobId: job.id,
      errorClass: "OTHER",
      message,
    });
    await finishTaggingJob(job.id, {
      status: "FAILED",
      errorClass: "OTHER",
      errorMessage: message,
      summary: {
        kind: "RE_EMBED",
        outcome: "failed",
        skipped: false,
        reason: "product_not_found",
      } satisfies ReEmbedSummary as Prisma.InputJsonValue,
    });
    return { outcome: "failed", tokens: 0, costMicros: 0, message };
  }

  // Decision A predicate exactly: skip if embeddingContentHash IS NOT
  // NULL AND === knowledgeContentHash. NULL hash → treat as "needs
  // embed". Hash mismatch → re-embed.
  const skip =
    product.embeddingContentHash !== null &&
    product.embeddingContentHash === product.knowledgeContentHash;

  if (skip) {
    const durationMs = Date.now() - startMs;
    log.info("re-embed skipped (hash match)", {
      event: "reembed_skipped",
      jobId: job.id,
      shopDomain: job.shopDomain,
      productId: job.productId,
      durationMs,
    });
    await updateTaggingProgress(job.id, {
      processedProducts: 1,
      totalProducts: 1,
    });
    await finishTaggingJob(job.id, {
      status: "SUCCEEDED",
      summary: {
        kind: "RE_EMBED",
        outcome: "skipped",
        skipped: true,
        reason: "hash-match",
        tokens: 0,
        costMicros: 0,
        durationMs,
      } satisfies ReEmbedSummary as Prisma.InputJsonValue,
    });
    return { outcome: "skipped", tokens: 0, costMicros: 0 };
  }

  // Look up storeMode for the embedding-text preamble. Single roundtrip
  // — same pattern as ai-tagger.generateTagsForProductById.
  const config = await prisma.merchantConfig.findUnique({
    where: { shop: job.shopDomain },
    select: { storeMode: true },
  });
  const storeMode: StoreMode =
    ((config?.storeMode ?? null) as StoreMode | null) ?? "GENERAL";

  const text = buildEmbeddingText(product as ProductForEmbedding, storeMode);

  let embedResult: { embedding: number[]; tokens: number };
  try {
    embedResult = await embedDocumentWithUsage(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = classifyVoyageError(message);
    log.error("re-embed Voyage call failed", {
      event: "reembed_voyage_failed",
      jobId: job.id,
      shopDomain: job.shopDomain,
      productId: job.productId,
      errorClass,
      message,
    });
    await logTaggingFailure({ jobId: job.id, errorClass, message });
    await finishTaggingJob(job.id, {
      status: "FAILED",
      errorClass,
      errorMessage: message,
      summary: {
        kind: "RE_EMBED",
        outcome: "failed",
        skipped: false,
        reason: "voyage_error",
      } satisfies ReEmbedSummary as Prisma.InputJsonValue,
    });
    return { outcome: "failed", tokens: 0, costMicros: 0, message };
  }

  const { tokens, costMicros } = computeVoyageCost(embedResult.tokens);

  // Atomic embedding + hash + updatedAt update in one SQL statement.
  // The `embedding` column is Unsupported("vector(1024)"); $executeRaw
  // is the only path Prisma exposes for writes (mirrors
  // embed-products.server.ts:194).
  const vectorLiteral = `[${embedResult.embedding.join(",")}]`;
  const newHash = product.knowledgeContentHash;
  await prisma.$executeRaw`
    UPDATE "Product"
    SET "embedding" = ${vectorLiteral}::vector,
        "embeddingContentHash" = ${newHash},
        "embeddingUpdatedAt" = NOW()
    WHERE id = ${product.id}
  `;

  // Record cost on the row. Voyage has no separate output token charge,
  // so outputTokens stays 0; inputTokens carries the full token count
  // for parity with the TaggingJob ledger column conventions.
  await prisma.taggingJob.update({
    where: { id: job.id },
    data: {
      costUsdMicros: { increment: BigInt(costMicros) },
      inputTokens: { increment: tokens },
    },
  });
  await updateTaggingProgress(job.id, {
    processedProducts: 1,
    totalProducts: 1,
  });

  const durationMs = Date.now() - startMs;
  log.info("re-embed completed", {
    event: "reembed_completed",
    jobId: job.id,
    shopDomain: job.shopDomain,
    productId: job.productId,
    tokens,
    costUsdMicros: costMicros,
    durationMs,
  });

  await finishTaggingJob(job.id, {
    status: "SUCCEEDED",
    summary: {
      kind: "RE_EMBED",
      outcome: "succeeded",
      skipped: false,
      tokens,
      costMicros,
      durationMs,
    } satisfies ReEmbedSummary as Prisma.InputJsonValue,
  });

  return { outcome: "succeeded", tokens, costMicros };
}

function classifyVoyageError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("status 401") || lower.includes("status 403")) return "AUTH";
  if (lower.includes("status 429")) return "RATE_LIMIT";
  if (lower.includes("status 5")) return "CONNECTION";
  if (lower.includes("etimedout") || lower.includes("econn")) return "CONNECTION";
  return "OTHER";
}
