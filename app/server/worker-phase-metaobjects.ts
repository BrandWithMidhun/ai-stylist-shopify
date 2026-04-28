// Phase 1 (PR-B): METAOBJECTS phase processor.
//
// Two-step flow:
//   1. Enumerate metaobject definitions (the merchant's metaobject
//      types — typically <5).
//   2. For each type, paginate metaobjects-by-type and upsert each
//      instance.
//
// Per Q1 of plan approval: this phase RESTARTS from type 0 on resume.
// We never write metaobjectsCursor. Total redo cost on resume is
// seconds, all upserts are idempotent, and the alternative (encoding
// `<type>:<cursor>` into one field) is more code for negligible
// savings.

import type { CatalogSyncJob } from "@prisma/client";
import prisma from "../db.server";
import {
  METAOBJECT_DEFINITIONS_QUERY,
  METAOBJECTS_BY_TYPE_PAGE_QUERY,
  type MetaobjectDefinitionsResponse,
  type MetaobjectsByTypeResponse,
} from "../lib/catalog/queries/knowledge.server";
import { normalizeMetaobject } from "../lib/catalog/knowledge-fetch.server";
import { upsertMetaobject } from "../lib/catalog/knowledge-upsert.server";
import {
  heartbeat,
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

export async function runMetaobjectsPhase(
  admin: AdminClient,
  job: CatalogSyncJob,
  shouldStop: ShouldStop,
): Promise<PhaseRunStats> {
  let processedItems = 0;
  let failedItems = 0;
  let costUnits = 0;
  let batchSeq = 0;

  const types = await listMetaobjectTypes(admin, shouldStop, (cost) => {
    costUnits += cost;
  });

  if (types.length === 0) {
    log.info("no metaobject types defined for shop", {
      jobId: job.id,
      shopDomain: job.shopDomain,
    });
    return { costUnits, driftCount: 0, failedItems: 0, processedItems: 0 };
  }

  for (const type of types) {
    if (shouldStop()) break;
    let cursor: string | null = null;
    let hasNextPage = true;
    while (hasNextPage && !shouldStop()) {
      batchSeq++;
      await heartbeat(job.id);
      const response = await admin.graphql(METAOBJECTS_BY_TYPE_PAGE_QUERY, {
        variables: { type, cursor },
      });
      const json = (await response.json()) as ShopifyGqlResponse<MetaobjectsByTypeResponse>;
      costUnits += json.extensions?.cost?.actualQueryCost ?? 0;
      const page = json.data?.metaobjects;
      if (!page) {
        throw new Error(`Shopify returned no metaobjects payload for type ${type}`);
      }

      await prisma.$transaction(async (tx) => {
        for (const node of page.nodes) {
          try {
            await upsertMetaobject({
              shopDomain: job.shopDomain,
              metaobject: normalizeMetaobject(node),
              tx,
            });
            processedItems++;
          } catch (err) {
            failedItems++;
            await logFailureSafe(tx, {
              jobId: job.id,
              shopDomain: job.shopDomain,
              kind: "METAOBJECT",
              shopifyGid: node.id,
              message: errorMessage(err),
            });
          }
        }
      });

      await updateProgress(job.id, {
        processedMetaobjects: processedItems,
        totalMetaobjects: processedItems,
      });

      log.debug("metaobjects batch", {
        jobId: job.id,
        shopDomain: job.shopDomain,
        phase: "METAOBJECTS",
        batchSeq,
        type,
        pageSize: page.nodes.length,
        processedItems,
        costThisPage: json.extensions?.cost?.actualQueryCost ?? 0,
      });

      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
      await throttleSleep(json);
    }
  }

  return { costUnits, driftCount: 0, failedItems, processedItems };
}

async function listMetaobjectTypes(
  admin: AdminClient,
  shouldStop: ShouldStop,
  recordCost: (cost: number) => void,
): Promise<string[]> {
  const types: string[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  while (hasMore && !shouldStop()) {
    const response = await admin.graphql(METAOBJECT_DEFINITIONS_QUERY, {
      variables: { cursor },
    });
    const json = (await response.json()) as ShopifyGqlResponse<MetaobjectDefinitionsResponse>;
    recordCost(json.extensions?.cost?.actualQueryCost ?? 0);
    const page = json.data?.metaobjectDefinitions;
    if (!page) {
      throw new Error("Shopify returned no metaobjectDefinitions payload");
    }
    for (const def of page.nodes) types.push(def.type);
    hasMore = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    await throttleSleep(json);
  }
  return types;
}
