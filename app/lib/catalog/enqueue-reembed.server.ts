// PR-3.1.6-mech.1: enqueue helper for kind=RE_EMBED TaggingJob rows.
//
// Sibling to enqueueTaggingForProduct (enqueue-tagging.server.ts). The two
// helpers are kept separate even though their structure is near-identical
// because their dedup semantics differ:
//
//   enqueueTaggingForProduct dedups against ANY queued job for the
//   (shopDomain, productId) tuple. That matches the partial unique index
//   `(shopDomain, productId) WHERE status='QUEUED'`, which is kind-agnostic.
//
//   enqueueReembedForProduct dedups against queued RE_EMBED jobs only.
//   This is the right semantic for the recurring-sync wire: we want
//   "another RE_EMBED is pending for this product" to dedup, not "any
//   tagging-related job exists for this product". A SINGLE_PRODUCT
//   ahead of us in the queue should NOT be treated as a queued RE_EMBED.
//
// Race window: if a different-kind QUEUED job exists for the product when
// this helper runs, the application-level dedup misses it (kind filter
// excludes it), but the partial unique index raises P2002 on insert. The
// catch handler does another kind-specific find — which returns null,
// since the conflict was a different kind. The function throws in that
// case. Caller (worker-tagging completion enqueue) catches + logs and
// does not fail the parent job. The mech.2 NULL-hash scanner backstop
// catches the long tail of products that miss this firing.
//
// triggerSource is required (no default). Each caller commits to the
// trigger semantic at the call site:
//   TAGGING_COMPLETION   — worker-tagging post-SUCCEEDED transition (mech.1)
//   NULL_HASH_SWEEP      — cron-tick scanner (mech.2)
//   UNEXCLUDE            — api.products.$id.exclude route on
//                          recommendationExcluded true→false (mech.3).
//                          Original mech.3 prompt assumed the wire belonged
//                          on webhooks.products.update; step-0 prep at
//                          .pr-3-1-6-mech-3-prep/01-webhook-payload-shape.txt
//                          surfaced that recommendationExcluded is an AI
//                          Stylist app column, not a Shopify field, so the
//                          webhook payload cannot carry it. Wire moved.
//   MANUAL               — admin-triggered manual re-embed
//   INITIAL_BACKFILL     — scripts/bulk-reembed-products.ts (3.1.5 survivor)

import type { TaggingJob } from "@prisma/client";
import prisma from "../../db.server";
import { log } from "../../server/worker-logger";

export type ReembedTriggerSource =
  | "TAGGING_COMPLETION"
  | "NULL_HASH_SWEEP"
  | "UNEXCLUDE"
  | "MANUAL"
  | "INITIAL_BACKFILL";

export type EnqueueReembedResult = {
  jobId: string;
  deduped: boolean;
};

export async function enqueueReembedForProduct(input: {
  shopDomain: string;
  productId: string;
  triggerSource: ReembedTriggerSource;
}): Promise<EnqueueReembedResult> {
  const existing = await findQueuedReembedJobForProduct(
    input.shopDomain,
    input.productId,
  );
  if (existing) {
    return { jobId: existing.id, deduped: true };
  }

  try {
    const created = await prisma.taggingJob.create({
      data: {
        shopDomain: input.shopDomain,
        productId: input.productId,
        kind: "RE_EMBED",
        status: "QUEUED",
        triggerSource: input.triggerSource,
      },
    });
    return { jobId: created.id, deduped: false };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findQueuedReembedJobForProduct(
        input.shopDomain,
        input.productId,
      );
      if (winner) {
        return { jobId: winner.id, deduped: true };
      }
      // P2002 from a different-kind queued job (kind-agnostic partial
      // unique index). Re-throw so caller can log and decide. The
      // scanner backstop will pick this up next sweep.
    }
    throw err;
  }
}

async function findQueuedReembedJobForProduct(
  shopDomain: string,
  productId: string,
): Promise<TaggingJob | null> {
  return prisma.taggingJob.findFirst({
    where: {
      shopDomain,
      productId,
      kind: "RE_EMBED",
      status: "QUEUED",
    },
    orderBy: { enqueuedAt: "desc" },
  });
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}

// PR-3.1.6-mech.3: un-exclude trigger.
//
// Called from app/routes/api.products.$id.exclude.tsx after the route's
// updateMany succeeds. Detects the (prior=true → incoming=false) transition
// and enqueues RE_EMBED with triggerSource=UNEXCLUDE. All other transitions
// are no-ops.
//
// Failure isolated: enqueue errors are logged via
// event="reembed_enqueue_error_unexclude" but do NOT throw. The route's HTTP
// response stays success regardless. The recommendation flag has been
// successfully toggled at this point; the embedding refresh is best-effort.
//
// No defensive eligibility re-check at this layer — worker-reembed handler
// (mech.1 path) does that at claim time. The route caller is the source of
// truth for "this product just became eligible", and the worker is the
// source of truth for "this product is still eligible at claim time".
export async function triggerReembedOnUnexclude(input: {
  shopDomain: string;
  productId: string;
  prior: { recommendationExcluded: boolean };
  incoming: { excluded: boolean };
}): Promise<void> {
  const isUnexcludeTransition =
    input.prior.recommendationExcluded === true &&
    input.incoming.excluded === false;
  if (!isUnexcludeTransition) return;

  try {
    const result = await enqueueReembedForProduct({
      shopDomain: input.shopDomain,
      productId: input.productId,
      triggerSource: "UNEXCLUDE",
    });
    log.info("reembed enqueued from unexclude", {
      event: "reembed_enqueued_from_unexclude",
      shopDomain: input.shopDomain,
      productId: input.productId,
      reembedJobId: result.jobId,
      deduped: result.deduped,
    });
  } catch (err) {
    log.error("reembed enqueue failed from unexclude", {
      event: "reembed_enqueue_error_unexclude",
      shopDomain: input.shopDomain,
      productId: input.productId,
      message: err instanceof Error ? err.message : String(err),
    });
    // Do NOT rethrow — route HTTP response is independent of enqueue
    // outcome. Op debt #20 framing is about getting the embedding to
    // refresh "soon"; mech.2 NULL-hash sweep backstop catches anything
    // this path drops.
  }
}
