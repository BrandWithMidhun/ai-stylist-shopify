// PR-3.1.6-mech.2: NULL-hash scanner backstop.
//
// Periodic sweep that catches products in stale-embedding state via paths
// the completion-driven inline RE_EMBED enqueue (mech.1) cannot see.
//
// What this scanner ACTUALLY catches (sweep filter is `embeddingContentHash
// IS NULL`):
//   - Products with embeddingContentHash never set: e.g. the planned 3.1.6
//     close pre-pass NULL-bump (op debt #26) that NULLs every ACTIVE row's
//     hash so the bulk re-embed under mech.1's APPROVED-only tag semantics
//     actually fires real Voyage calls instead of getting Decision-A-skipped.
//   - Long-tail safety net: any path that lands a product in NULL-hash
//     state outside the AI-tagging path (manual SQL writes, partial
//     migrations, etc).
//
// What this scanner does NOT catch (intentional — handled elsewhere):
//   - Metaobject NULL fan-out via `bumpHashForMetaobjectReferents`. That
//     function NULLs `knowledgeContentHash`, not `embeddingContentHash`. The
//     subsequent DELTA pass either (a) recomputes a non-equal hash →
//     hashChanged=true → SINGLE_PRODUCT enqueued → mech.1's completion wire
//     enqueues RE_EMBED, OR (b) recomputes the same hash → no real content
//     drift → no re-embed needed. The DELTA chain handles this case
//     correctly without scanner intervention.
//   - Tag-only drift (Thread 3 Finding 1 — embedding text includes
//     ProductTag rows but knowledgeContentHash excludes them). Decision A's
//     skip predicate is incomplete-by-design. The scanner does not
//     second-guess the predicate; mech.1's completion-driven wire is the
//     correct trigger for tag drift.
//
// Filter:
//   embeddingContentHash IS NULL
//   AND status = 'ACTIVE'
//   AND deletedAt IS NULL
//   AND recommendationExcluded = false
//
// Mirrors `scripts/bulk-reembed-products.ts` (3.1.5 survivor) so DRAFT/
// ARCHIVED/deleted/excluded products don't get swept — same v2-pipeline
// read-path semantics as everywhere else.
//
// Bounded LIMIT: SWEEP_BATCH_LIMIT (default 500, env-overridable). Anything
// beyond gets caught on the next sweep. Worst-case cost per sweep per shop
// at 500 jobs × ~$0.000031/job ≈ $0.016, drain time ~2.4min serial via
// single-claim worker. Negligible.
//
// Cadence: invoked from cron-tick.server.ts inside the per-shop iteration,
// after the DELTA enqueue completes (or fails — Decision 8: scanner is a
// different concern from DELTA). Dedup against existing QUEUED RE_EMBED
// rows is delegated to `enqueueReembedForProduct` (mech.1 helper, proven
// in mech.1.5 TC3).

import type { PrismaClient } from "@prisma/client";
import { enqueueReembedForProduct } from "../lib/catalog/enqueue-reembed.server";
import { log } from "./worker-logger";

const SWEEP_BATCH_LIMIT = Number(process.env.NULL_HASH_SWEEP_BATCH_LIMIT ?? 500);

export interface NullHashSweepResult {
  shopDomain: string;
  eligibleCount: number;
  enqueuedCount: number;
  alreadyQueuedCount: number;
  durationMs: number;
}

export async function runNullHashSweep(
  prisma: PrismaClient,
  shopDomain: string,
): Promise<NullHashSweepResult> {
  const startedAt = Date.now();

  const eligible = await prisma.product.findMany({
    where: {
      shopDomain,
      embeddingContentHash: null,
      status: "ACTIVE",
      deletedAt: null,
      recommendationExcluded: false,
    },
    select: { id: true },
    take: SWEEP_BATCH_LIMIT,
  });

  let enqueuedCount = 0;
  let alreadyQueuedCount = 0;

  for (const product of eligible) {
    try {
      const enqResult = await enqueueReembedForProduct({
        shopDomain,
        productId: product.id,
        triggerSource: "NULL_HASH_SWEEP",
      });
      if (enqResult.deduped) alreadyQueuedCount += 1;
      else enqueuedCount += 1;
    } catch (err) {
      // Per-product enqueue failure is logged and skipped; the sweep
      // continues with the next product. The worst case (a different-kind
      // QUEUED job blocking via the kind-agnostic partial unique index)
      // resolves itself on the next sweep — same long-tail safety net
      // posture mech.1's completion wire took.
      log.error("null hash sweep enqueue failed", {
        event: "null_hash_sweep_enqueue_error",
        shopDomain,
        productId: product.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  const result: NullHashSweepResult = {
    shopDomain,
    eligibleCount: eligible.length,
    enqueuedCount,
    alreadyQueuedCount,
    durationMs,
  };

  // Op debt #24 fold-in (scanner-side coverage only): emit on every sweep
  // including eligibleCount=0 so an idle scanner is distinguishable from a
  // stopped scanner without log spam. Cron tick out-of-window observability
  // is a separate question, deferred.
  log.info("null hash sweep evaluated", {
    event: "null_hash_sweep_evaluated",
    ...result,
  });

  return result;
}
