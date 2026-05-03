// PR-2.1: enqueue helper for the TaggingJob queue.
//
// QUEUED-only dedup: if a row already exists for (shopDomain,
// productId) with status='QUEUED', return that row's id without
// inserting. The DB partial unique index is the safety net; this
// function is the application-level fast path that avoids the
// constraint raise on the common burst case.
//
// Mirrors enqueue-delta.server.ts (PR-C) for the catalog DELTA queue.
//
// Trigger sources are free strings:
//   WEBHOOK_CREATE        — products/create webhook handler
//   DELTA_HASH_CHANGE     — worker-phase-products after upsertProductKnowledge
//   MANUAL                — admin-triggered retag from /api/intelligence/retag
//   INITIAL_BACKFILL      — 2.2's first-pass tagging script (not enqueue-tagging)
//   CRON                  — reserved for future cron-driven retag (e.g.
//                           daily resurrection of incomplete tagging)

import type { TaggingJob, TaggingJobKind } from "@prisma/client";
import prisma from "../../db.server";
import { findQueuedJobForProduct } from "./tagging-jobs.server";

export type EnqueueTaggingResult = {
  jobId: string;
  deduped: boolean;
};

export async function enqueueTaggingForProduct(params: {
  shopDomain: string;
  productId: string;
  triggerSource: string;
  kind?: Extract<TaggingJobKind, "SINGLE_PRODUCT" | "MANUAL_RETAG">;
}): Promise<EnqueueTaggingResult> {
  const kind = params.kind ?? "SINGLE_PRODUCT";

  // Fast-path dedup. The DB partial unique index would raise on a
  // race-loser; we'd rather return the winner cleanly than
  // try/catch the constraint. The window between the SELECT and the
  // INSERT is short, but we still wrap in a tx with a retry so the
  // race-loser gets the existing row rather than crashing.
  const existing = await findQueuedJobForProduct(params.shopDomain, params.productId);
  if (existing) {
    return { jobId: existing.id, deduped: true };
  }

  try {
    const created = await prisma.taggingJob.create({
      data: {
        shopDomain: params.shopDomain,
        productId: params.productId,
        kind,
        status: "QUEUED",
        triggerSource: params.triggerSource,
      },
    });
    return { jobId: created.id, deduped: false };
  } catch (err) {
    // Race: another caller created the row between our SELECT and
    // INSERT. The partial unique index raised. Re-read and return
    // the winner.
    if (isUniqueViolation(err)) {
      const winner = await findQueuedJobForProduct(params.shopDomain, params.productId);
      if (winner) {
        return { jobId: winner.id, deduped: true };
      }
    }
    throw err;
  }
}

// enqueueInitialBackfill — fired by the future 2.2 backfill script. Not
// used by webhooks, not used by the cron. Kept here for symmetry with
// the SINGLE_PRODUCT path. Returns deduped=true if a backfill is
// already in flight for the shop (the DB partial unique enforces this
// at the constraint level too).
export async function enqueueInitialBackfill(params: {
  shopDomain: string;
  triggerSource?: string;
}): Promise<EnqueueTaggingResult> {
  const existing = await prisma.taggingJob.findFirst({
    where: {
      shopDomain: params.shopDomain,
      kind: "INITIAL_BACKFILL",
      status: { in: ["QUEUED", "RUNNING"] },
    },
    orderBy: { enqueuedAt: "desc" },
  });
  if (existing) {
    return { jobId: existing.id, deduped: true };
  }
  try {
    const created = await prisma.taggingJob.create({
      data: {
        shopDomain: params.shopDomain,
        productId: null,
        kind: "INITIAL_BACKFILL",
        status: "QUEUED",
        triggerSource: params.triggerSource ?? "INITIAL_BACKFILL",
      },
    });
    return { jobId: created.id, deduped: false };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await prisma.taggingJob.findFirst({
        where: {
          shopDomain: params.shopDomain,
          kind: "INITIAL_BACKFILL",
          status: { in: ["QUEUED", "RUNNING"] },
        },
      });
      if (winner) {
        return { jobId: winner.id, deduped: true };
      }
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}

export type { TaggingJob };
