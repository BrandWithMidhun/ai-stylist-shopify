// Full-catalog sync worker.
//
// Invocation: fire-and-forget from POST /api/catalog/sync. The action returns
// { jobId } immediately; this function runs in the background inside the same
// Node process and mutates the in-memory job registry as it progresses.
//
// TODO(005a-followup): reconciliation cron (spec 4.4). Not part of 005a.
// Deferred because webhooks + manual re-sync cover 99% of drift, and adding
// node-cron / Railway scheduled jobs is infrastructure churn we don't need
// until we see actual drift in the wild.

import prisma from "../../db.server";
import { unauthenticated } from "../../shopify.server";
import {
  PRODUCTS_COUNT_QUERY,
  PRODUCTS_PAGE_QUERY,
  type ProductsCountResponse,
  type ProductsPageResponse,
} from "./graphql.server";
import {
  completeJob,
  failJob,
  incrementJobProgress,
  setJobTotal,
} from "./jobs.server";
import {
  normalizeFromGraphQL,
  type NormalizedProduct,
  upsertNormalizedProduct,
} from "./upsert.server";

// Adaptive batching: cap each transaction at ~100 total upserts (product +
// variants) rather than a fixed product count. A product with 100 variants
// (Shopify's per-page variant cap) would otherwise blow the transaction
// timeout when bundled with others. A single product that exceeds the target
// still becomes its own batch — the 15s timeout is sized to absorb it.
const TRANSACTION_UPSERT_TARGET = 100;
const TRANSACTION_OPTIONS = { timeout: 15000, maxWait: 5000 };

function upsertCost(n: NormalizedProduct): number {
  return 1 + n.variants.length;
}

export async function runCatalogSync(params: {
  shopDomain: string;
  jobId: string;
}): Promise<void> {
  const { shopDomain, jobId } = params;

  try {
    const { admin } = await unauthenticated.admin(shopDomain);

    const countResponse = await admin.graphql(PRODUCTS_COUNT_QUERY);
    const countJson = (await countResponse.json()) as {
      data?: ProductsCountResponse;
    };
    const total = countJson.data?.productsCount.count ?? 0;
    setJobTotal(jobId, total);

    let cursor: string | null = null;
    let hasNextPage = true;

    while (hasNextPage) {
      const pageResponse = await admin.graphql(PRODUCTS_PAGE_QUERY, {
        variables: { cursor },
      });
      const pageJson = (await pageResponse.json()) as {
        data?: ProductsPageResponse;
      };
      const page = pageJson.data?.products;
      if (!page) {
        throw new Error("Shopify returned no products payload.");
      }

      const normalized = page.nodes.map(normalizeFromGraphQL);

      let batch: NormalizedProduct[] = [];
      let batchCost = 0;

      const flush = async () => {
        if (batch.length === 0) return;
        const toWrite = batch;
        await prisma.$transaction(async (tx) => {
          for (const n of toWrite) {
            await upsertNormalizedProduct(shopDomain, n, tx);
          }
        }, TRANSACTION_OPTIONS);
        incrementJobProgress(jobId, toWrite.length);
        batch = [];
        batchCost = 0;
      };

      for (const n of normalized) {
        const cost = upsertCost(n);
        if (batch.length > 0 && batchCost + cost > TRANSACTION_UPSERT_TARGET) {
          await flush();
        }
        batch.push(n);
        batchCost += cost;
      }
      await flush();

      hasNextPage = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    await prisma.merchantConfig.update({
      where: { shop: shopDomain },
      data: { lastFullSyncAt: new Date() },
    });

    completeJob(jobId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[catalog-sync] ${shopDomain} job ${jobId} failed`, err);
    failJob(jobId, err);
  }
}
