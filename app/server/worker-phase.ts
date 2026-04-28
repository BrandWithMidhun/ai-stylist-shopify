// Phase 1 (PR-B): phase dispatcher for the catalog sync worker.
//
// Dispatches a claimed CatalogSyncJob through the four-phase
// sequence: COLLECTIONS → METAOBJECTS → PRODUCTS → FINALIZE. Each
// phase is implemented in its own module; this file orchestrates
// resume-from-phase and accumulates the run summary.
//
// Resume semantics:
//   - If job.phase is non-null we start at that phase.
//   - COLLECTIONS / PRODUCTS resume from their cursors.
//   - METAOBJECTS restarts from type 0 (per Q1 of plan approval).
//
// Per-product/per-collection/per-metaobject failures DO NOT fail the
// job — they land in CatalogSyncJobFailure. Phase-level failures
// (e.g. Shopify auth error, bad payload) bubble up to the caller
// (worker.ts) which marks the job FAILED.

import type {
  CatalogSyncJob,
  Prisma,
  StoreMode,
} from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { updateProgress } from "../lib/catalog/sync-jobs.server";
import { log } from "./worker-logger";
import { type AdminClient, type ShouldStop } from "./worker-phase-helpers";
import { runCollectionsPhase } from "./worker-phase-collections";
import { runMetaobjectsPhase } from "./worker-phase-metaobjects";
import { runProductsPhase } from "./worker-phase-products";

export type ProcessJobOutcome = {
  status: "SUCCEEDED" | "ABORTED";
  summary: Prisma.InputJsonValue;
};

const PHASE_ORDER = ["COLLECTIONS", "METAOBJECTS", "PRODUCTS"] as const;
type DataPhase = (typeof PHASE_ORDER)[number];

export async function processJob(
  job: CatalogSyncJob,
  shouldStop: ShouldStop,
  onPhaseChange: (phase: string | null) => void,
): Promise<ProcessJobOutcome> {
  const startMs = Date.now();
  const { admin } = await unauthenticated.admin(job.shopDomain);

  const config = await prisma.merchantConfig.findUnique({
    where: { shop: job.shopDomain },
    select: { storeMode: true, lastKnowledgeSyncAt: true },
  });
  const storeMode: StoreMode = config?.storeMode ?? "GENERAL";
  const deltaWatermark = config?.lastKnowledgeSyncAt ?? null;

  const totals = {
    costUnits: 0,
    driftCount: 0,
    failedItems: 0,
    processedCollections: 0,
    processedMetaobjects: 0,
    processedProducts: 0,
  };

  const resumeFrom = (job.phase ?? "COLLECTIONS") as DataPhase;
  const startIdx = Math.max(0, PHASE_ORDER.indexOf(resumeFrom));
  if (startIdx > 0) {
    log.info("resuming job at later phase", {
      jobId: job.id,
      shopDomain: job.shopDomain,
      resumeFrom,
    });
  }

  for (let i = startIdx; i < PHASE_ORDER.length; i++) {
    if (shouldStop()) {
      return aborted(job, totals, startMs, "stopped before phase");
    }
    const phaseName = PHASE_ORDER[i];
    onPhaseChange(phaseName);
    await updateProgress(job.id, { phase: phaseName });
    log.info("phase begin", {
      jobId: job.id,
      shopDomain: job.shopDomain,
      kind: job.kind,
      phase: phaseName,
    });

    const stats = await runPhase(
      phaseName,
      admin as unknown as AdminClient,
      job,
      storeMode,
      deltaWatermark,
      shouldStop,
    );

    totals.costUnits += stats.costUnits;
    totals.driftCount += stats.driftCount;
    totals.failedItems += stats.failedItems;
    if (phaseName === "COLLECTIONS") totals.processedCollections = stats.processedItems;
    if (phaseName === "METAOBJECTS") totals.processedMetaobjects = stats.processedItems;
    if (phaseName === "PRODUCTS") totals.processedProducts = stats.processedItems;

    log.info("phase end", {
      jobId: job.id,
      shopDomain: job.shopDomain,
      phase: phaseName,
      processedItems: stats.processedItems,
      failedItems: stats.failedItems,
      costUnits: stats.costUnits,
    });

    if (shouldStop()) {
      return aborted(job, totals, startMs, `stopped after ${phaseName}`);
    }
  }

  // FINALIZE — bookkeeping only, no Shopify calls.
  onPhaseChange("FINALIZE");
  await updateProgress(job.id, { phase: "FINALIZE" });
  await runFinalizePhase(job);

  return {
    status: "SUCCEEDED",
    summary: buildSummary(job, totals, startMs, "succeeded"),
  };
}

async function runPhase(
  phaseName: DataPhase,
  admin: AdminClient,
  job: CatalogSyncJob,
  storeMode: StoreMode,
  deltaWatermark: Date | null,
  shouldStop: ShouldStop,
) {
  if (phaseName === "COLLECTIONS") {
    return runCollectionsPhase(admin, job, shouldStop);
  }
  if (phaseName === "METAOBJECTS") {
    return runMetaobjectsPhase(admin, job, shouldStop);
  }
  return runProductsPhase(admin, job, storeMode, deltaWatermark, shouldStop);
}

function aborted(
  job: CatalogSyncJob,
  totals: SummaryTotals,
  startMs: number,
  reason: string,
): ProcessJobOutcome {
  return {
    status: "ABORTED",
    summary: buildSummary(job, totals, startMs, reason),
  };
}

type SummaryTotals = {
  costUnits: number;
  driftCount: number;
  failedItems: number;
  processedCollections: number;
  processedMetaobjects: number;
  processedProducts: number;
};

function buildSummary(
  job: CatalogSyncJob,
  totals: SummaryTotals,
  startMs: number,
  outcome: string,
): Prisma.InputJsonValue {
  const summary: Record<string, Prisma.InputJsonValue> = {
    outcome,
    durationMs: Date.now() - startMs,
    kind: job.kind,
    costUnits: totals.costUnits,
    processedCollections: totals.processedCollections,
    processedMetaobjects: totals.processedMetaobjects,
    processedProducts: totals.processedProducts,
    failedItems: totals.failedItems,
  };
  if (job.kind === "DELTA") {
    summary.driftCount = totals.driftCount;
  }
  return summary;
}

async function runFinalizePhase(job: CatalogSyncJob): Promise<void> {
  const now = new Date();
  await prisma.merchantConfig.upsert({
    where: { shop: job.shopDomain },
    create: {
      shop: job.shopDomain,
      lastFullSyncAt: job.kind === "DELTA" ? null : now,
      lastKnowledgeSyncAt: now,
    },
    update: {
      lastKnowledgeSyncAt: now,
      ...(job.kind === "DELTA" ? {} : { lastFullSyncAt: now }),
    },
  });
}
