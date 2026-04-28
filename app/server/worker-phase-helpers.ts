// Phase 1 (PR-B): shared helpers used by every phase processor.
//
// Throttle waiter, error stringifier, in-tx failure logger. Kept in
// their own module so the per-phase files (worker-phase-collections,
// worker-phase-metaobjects, worker-phase-products) stay readable.

import type { Prisma } from "@prisma/client";
import {
  extractThrottle,
  sleep,
  sleepMsForBudget,
  type ShopifyGqlResponse,
} from "../lib/catalog/shopify-throttle.server";
import { log } from "./worker-logger";

export const PER_PAGE_BUFFER = 200;

export type PhaseRunStats = {
  costUnits: number;
  driftCount: number;
  failedItems: number;
  processedItems: number;
};

export type ShouldStop = () => boolean;

export async function throttleSleep<T>(
  response: ShopifyGqlResponse<T>,
): Promise<void> {
  const status = extractThrottle(response);
  const ms = sleepMsForBudget(status, PER_PAGE_BUFFER);
  if (ms > 0) {
    log.debug("throttle sleep", {
      ms,
      currentlyAvailable: status?.currentlyAvailable,
      restoreRate: status?.restoreRate,
    });
    await sleep(ms);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// Failure-row writer used inside per-batch transactions. Catching
// per-product errors and writing a CatalogSyncJobFailure row alongside
// an errorCount bump keeps both records consistent with the rest of
// the batch's upserts — committed together if the tx succeeds, rolled
// back together if it fails. Per-product try/catch ensures one bad
// product doesn't roll back its whole batch.
export async function logFailureSafe(
  tx: Prisma.TransactionClient,
  params: {
    jobId: string;
    shopDomain: string;
    kind: string;
    shopifyGid: string | null;
    message: string;
  },
): Promise<void> {
  const truncated =
    params.message.length > 1024
      ? params.message.slice(0, 1024) + "…"
      : params.message;
  await tx.catalogSyncJob.update({
    where: { id: params.jobId },
    data: { errorCount: { increment: 1 } },
  });
  await tx.catalogSyncJobFailure.create({
    data: {
      jobId: params.jobId,
      shopDomain: params.shopDomain,
      kind: params.kind,
      shopifyGid: params.shopifyGid,
      message: truncated,
      attempt: 1,
    },
  });
  log.warn("item failure", {
    jobId: params.jobId,
    shopDomain: params.shopDomain,
    kind: params.kind,
    shopifyGid: params.shopifyGid,
    message: truncated,
  });
}

export type AdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json: () => Promise<unknown> }>;
};
