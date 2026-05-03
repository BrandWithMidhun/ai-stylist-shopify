// Phase 1 (PR-B): PRODUCTS phase processor.
//
// Paginate products via PRODUCT_KNOWLEDGE_PAGE_QUERY. INITIAL/
// MANUAL_RESYNC pass query=null; DELTA passes
// query="updated_at:>=<watermark>". Per-product upsert via
// knowledge-upsert.server (transactional, stale-write-safe). Per-
// product errors land in CatalogSyncJobFailure and the job continues.
//
// Page size 50 is set inside the query constant in PR-A's
// queries/knowledge.server. Decision criterion: if measured per-page
// actualQueryCost P95 > 700 over the dev-store INITIAL run, drop
// the GraphQL `first: 50` to `first: 25` — single-line change.

import type { CatalogSyncJob, StoreMode } from "@prisma/client";
import prisma from "../db.server";
import {
  PRODUCT_KNOWLEDGE_PAGE_QUERY,
  PRODUCT_METAFIELDS_PAGE_QUERY,
  type GqlKnowledgeProduct,
  type ProductKnowledgePageResponse,
  type ProductMetafieldsPageResponse,
} from "../lib/catalog/queries/knowledge.server";
import { normalizeKnowledgeProduct } from "../lib/catalog/knowledge-fetch.server";
import { upsertProductKnowledge } from "../lib/catalog/knowledge-upsert.server";
import { enqueueTaggingForProduct } from "../lib/catalog/enqueue-tagging.server";
import {
  heartbeat,
  saveCursor,
  updateProgress,
} from "../lib/catalog/sync-jobs.server";
import type { ShopifyGqlResponse } from "../lib/catalog/shopify-throttle.server";
import { log } from "./worker-logger";
import {
  errorMessage,
  logFailureSafe,
  throttleSleep,
  type AdminClient,
  type PhaseRunStats,
  type ShouldStop,
} from "./worker-phase-helpers";

export async function runProductsPhase(
  admin: AdminClient,
  job: CatalogSyncJob,
  storeMode: StoreMode,
  deltaWatermark: Date | null,
  shouldStop: ShouldStop,
): Promise<PhaseRunStats> {
  let cursor: string | null = job.productsCursor ?? null;
  let hasNextPage = true;
  let processedItems = 0;
  let failedItems = 0;
  let driftCount = 0;
  let costUnits = 0;
  let batchSeq = 0;
  let highRateLogged = false;
  // PR-C C.3 cursor age probe: track when the cursor we are about to
  // use was last persisted. Initialized from job.productsCursorAt so a
  // resumed worker measures the cross-restart staleness; updated to
  // now() after each saveCursor write (matches the column write below).
  let cursorWrittenAt: Date | null = job.productsCursorAt ?? null;

  const queryFilter = buildProductsQueryFilter(job.kind, deltaWatermark);

  while (hasNextPage && !shouldStop()) {
    batchSeq++;
    await heartbeat(job.id);
    const cursorAgeMs =
      cursor !== null && cursorWrittenAt !== null
        ? Date.now() - cursorWrittenAt.getTime()
        : null;
    const response = await admin.graphql(PRODUCT_KNOWLEDGE_PAGE_QUERY, {
      variables: { cursor, query: queryFilter },
    });
    const json = (await response.json()) as ShopifyGqlResponse<ProductKnowledgePageResponse>;
    const pageCost = json.extensions?.cost?.actualQueryCost ?? 0;
    costUnits += pageCost;
    const page = json.data?.products;
    if (!page) {
      throw new Error("Shopify returned no products payload");
    }

    // Pre-fetch any extra metafield pages OUTSIDE the transaction —
    // these calls go to Shopify and we don't want long-running tx.
    const enrichedNodes: Array<{
      node: GqlKnowledgeProduct;
      extras: GqlKnowledgeProduct["metafields"]["nodes"][];
    }> = [];
    for (const node of page.nodes) {
      enrichedNodes.push({
        node,
        extras: await fetchExtraMetafieldPages(admin, node),
      });
    }

    // PR-2.1: collect (productId, hashChanged) for products that
    // upserted successfully. After the transaction commits, we
    // enqueue a tagging job for each hashChanged=true product. The
    // enqueue is OUTSIDE the upsert transaction by design — tagging
    // shouldn't ride on the catalog-sync transaction's lifetime, and
    // an enqueue failure should not abort the catalog sync.
    const hashChangedProductIds: string[] = [];

    await prisma.$transaction(
      async (tx) => {
        for (const { node, extras } of enrichedNodes) {
          try {
            const knowledge = normalizeKnowledgeProduct(node, extras);
            const result = await upsertProductKnowledge({
              shopDomain: job.shopDomain,
              storeMode,
              knowledge,
              tx,
            });
            processedItems++;
            if (result.hashChanged) {
              driftCount++;
              if (result.productId) {
                hashChangedProductIds.push(result.productId);
              }
            }
            if (result.staleSkipped) {
              log.debug("product upsert stale-skipped", {
                jobId: job.id,
                shopDomain: job.shopDomain,
                productGid: node.id,
              });
            }
          } catch (err) {
            failedItems++;
            await logFailureSafe(tx, {
              jobId: job.id,
              shopDomain: job.shopDomain,
              kind: "PRODUCT",
              shopifyGid: node.id,
              message: errorMessage(err),
            });
          }
        }
        await saveCursor(
          job.id,
          { productsCursor: page.pageInfo.endCursor },
          tx,
        );
        cursorWrittenAt = new Date();
      },
      { timeout: 30000, maxWait: 5000 },
    );

    // PR-2.1: enqueue tagging for each hashChanged product. Errors
    // here are logged and swallowed — a tagging-enqueue failure must
    // never fail the catalog sync.
    for (const productId of hashChangedProductIds) {
      try {
        const enqueueResult = await enqueueTaggingForProduct({
          shopDomain: job.shopDomain,
          productId,
          triggerSource: "DELTA_HASH_CHANGE",
        });
        log.info("tagging job enqueued from DELTA hash change", {
          event: "tagging_job_enqueued",
          jobId: enqueueResult.jobId,
          shopDomain: job.shopDomain,
          productId,
          deduped: enqueueResult.deduped,
          triggerSource: "DELTA_HASH_CHANGE",
          syncJobId: job.id,
        });
      } catch (err) {
        log.warn("tagging enqueue failed; continuing sync", {
          event: "tagging_enqueue_error",
          jobId: job.id,
          shopDomain: job.shopDomain,
          productId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await updateProgress(job.id, {
      processedProducts: processedItems,
      failedProducts: failedItems,
      totalProducts: processedItems,
    });

    log.info("products batch", {
      jobId: job.id,
      shopDomain: job.shopDomain,
      phase: "PRODUCTS",
      batchSeq,
      pageSize: page.nodes.length,
      processedItems,
      failedItems,
      driftCount,
      costThisPage: pageCost,
      costSoFar: costUnits,
      cursorAgeMs,
    });

    if (
      !highRateLogged &&
      processedItems >= 50 &&
      failedItems / processedItems > 0.1
    ) {
      log.warn("high per-product failure rate", {
        jobId: job.id,
        shopDomain: job.shopDomain,
        failureRatio: failedItems / processedItems,
        processedItems,
        failedItems,
      });
      highRateLogged = true;
    }

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    await throttleSleep(json);
  }

  if (!shouldStop()) {
    await saveCursor(job.id, { productsCursor: null });
  }
  return { costUnits, driftCount, failedItems, processedItems };
}

function buildProductsQueryFilter(
  kind: CatalogSyncJob["kind"],
  watermark: Date | null,
): string | null {
  if (kind !== "DELTA") return null;
  if (!watermark) return null;
  // Shopify search syntax — ISO timestamp prefix. The query selects
  // products whose updated_at is >= watermark, inclusive.
  return `updated_at:>=${watermark.toISOString()}`;
}

async function fetchExtraMetafieldPages(
  admin: AdminClient,
  product: GqlKnowledgeProduct,
): Promise<GqlKnowledgeProduct["metafields"]["nodes"][]> {
  if (!product.metafields.pageInfo.hasNextPage) return [];
  const extras: GqlKnowledgeProduct["metafields"]["nodes"][] = [];
  let cursor: string | null = product.metafields.pageInfo.endCursor;
  let pages = 0;
  while (cursor) {
    const response = await admin.graphql(PRODUCT_METAFIELDS_PAGE_QUERY, {
      variables: { id: product.id, cursor },
    });
    const json = (await response.json()) as ShopifyGqlResponse<ProductMetafieldsPageResponse>;
    const page = json.data?.product?.metafields;
    if (!page) break;
    extras.push(page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    pages++;
    await throttleSleep(json);
    if (pages >= 10) {
      log.warn("product metafield pagination exceeded 10 pages", {
        productGid: product.id,
      });
      break;
    }
  }
  return extras;
}
