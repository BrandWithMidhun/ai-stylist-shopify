// Phase 1 (PR-B): COLLECTIONS phase processor.
//
// Paginate collections via COLLECTIONS_PAGE_QUERY. Per-collection
// upserts run in a transaction with the cursor save so a crash gives
// us exactly-once semantics on resume. Per-item errors land in
// CatalogSyncJobFailure and the batch continues; whole-page errors
// (no payload) bubble up to the dispatcher.

import type { CatalogSyncJob } from "@prisma/client";
import prisma from "../db.server";
import {
  COLLECTIONS_PAGE_QUERY,
  type CollectionsPageResponse,
} from "../lib/catalog/queries/knowledge.server";
import { normalizeCollection } from "../lib/catalog/knowledge-fetch.server";
import { upsertCollection } from "../lib/catalog/knowledge-upsert.server";
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

export async function runCollectionsPhase(
  admin: AdminClient,
  job: CatalogSyncJob,
  shouldStop: ShouldStop,
): Promise<PhaseRunStats> {
  let cursor: string | null = job.collectionsCursor ?? null;
  let hasNextPage = true;
  let processedItems = 0;
  let failedItems = 0;
  let costUnits = 0;
  let totalCollections = 0;
  let batchSeq = 0;

  while (hasNextPage && !shouldStop()) {
    batchSeq++;
    await heartbeat(job.id);
    const response = await admin.graphql(COLLECTIONS_PAGE_QUERY, {
      variables: { cursor },
    });
    const json = (await response.json()) as ShopifyGqlResponse<CollectionsPageResponse>;
    costUnits += json.extensions?.cost?.actualQueryCost ?? 0;
    const page = json.data?.collections;
    if (!page) {
      throw new Error("Shopify returned no collections payload");
    }

    await prisma.$transaction(async (tx) => {
      for (const node of page.nodes) {
        try {
          await upsertCollection({
            shopDomain: job.shopDomain,
            collection: normalizeCollection(node),
            tx,
          });
          processedItems++;
        } catch (err) {
          failedItems++;
          await logFailureSafe(tx, {
            jobId: job.id,
            shopDomain: job.shopDomain,
            kind: "COLLECTION",
            shopifyGid: node.id,
            message: errorMessage(err),
          });
        }
      }
      await saveCursor(
        job.id,
        { collectionsCursor: page.pageInfo.endCursor },
        tx,
      );
    });

    totalCollections = processedItems;
    await updateProgress(job.id, {
      processedCollections: processedItems,
      totalCollections,
    });

    log.debug("collections batch", {
      jobId: job.id,
      shopDomain: job.shopDomain,
      phase: "COLLECTIONS",
      batchSeq,
      pageSize: page.nodes.length,
      processedItems,
      failedItems,
      costThisPage: json.extensions?.cost?.actualQueryCost ?? 0,
    });

    hasNextPage = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    await throttleSleep(json);
  }

  if (!shouldStop()) {
    await saveCursor(job.id, { collectionsCursor: null });
  }
  return { costUnits, driftCount: 0, failedItems, processedItems };
}
