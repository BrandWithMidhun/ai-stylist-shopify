// Shared loader helpers for the intelligence dashboard route.
//
// Keeps app/routes/app.products.intelligence.tsx thin by pulling the product
// list + mode branching logic into a server-only helper.
//
// Phase 1 (PR-A): the active sync job is now read from the DB-backed
// CatalogSyncJob table (via sync-jobs.server.ts). The shape consumed by
// the dashboard components stays identical so no UI churn is needed.

import prisma from "../../db.server";
import type { AxisOptions } from "./axis-options";
import { computeTagStatus, type TagStatus } from "./tag-status";
import { getActiveJobForShop } from "./sync-jobs.server";
import {
  loadDashboardStats,
  type DashboardStats,
} from "./stats.server";
import { getEffectiveAxes } from "./taxonomy";
import type { StoreMode } from "./store-axes";

// TODO(005c-followup): 500 cap is the v1 ceiling. Add "Load more" pagination
// once first merchants exceed this. Cursor pagination already exists in 005a.
const PRODUCT_LIMIT = 500;

export type ProductListItem = {
  id: string;
  title: string;
  handle: string;
  status: string;
  inventoryStatus: string;
  featuredImageUrl: string | null;
  productType: string | null;
  recommendationExcluded: boolean;
  taxonomyNodeId: string | null;
  tags: Array<{
    axis: string;
    value: string;
    source: string;
    locked: boolean;
  }>;
  tagStatus: TagStatus;
};

export type ActiveSyncJob = {
  jobId: string;
  progress: number;
  total: number;
  startedAt: string;
};

export type IntelligenceLoaderData =
  | { mode: "EMPTY" }
  | {
      mode: "SYNCING_FIRST_TIME";
      job: ActiveSyncJob;
    }
  | {
      mode: "DASHBOARD";
      storeMode: string;
      stats: DashboardStats;
      products: ProductListItem[];
      productLimit: number;
      activeSyncJob: ActiveSyncJob | null;
      // Effective axis definitions per taxonomy node, pre-computed for the
      // distinct nodeIds present in the loaded product window. Drawer looks
      // up by product.taxonomyNodeId and falls back to storeMode axes when
      // the product has no node yet (006a §4.2 / Decision G). O(nodes×depth)
      // — fine while shops have <100 nodes / <5 depth.
      nodeAxesByNodeId: Record<string, AxisOptions>;
    };

export async function loadIntelligenceData(
  shopDomain: string,
): Promise<IntelligenceLoaderData> {
  const config = await prisma.merchantConfig.findUnique({
    where: { shop: shopDomain },
    select: { lastFullSyncAt: true, storeMode: true },
  });

  const activeJob = await resolveActiveSyncJob(shopDomain);

  if (!config?.lastFullSyncAt) {
    if (activeJob) {
      return { mode: "SYNCING_FIRST_TIME", job: activeJob };
    }
    return { mode: "EMPTY" };
  }

  const [stats, products] = await Promise.all([
    loadDashboardStats(shopDomain),
    prisma.product.findMany({
      where: { shopDomain, deletedAt: null },
      include: { tags: true },
      orderBy: { shopifyUpdatedAt: "desc" },
      take: PRODUCT_LIMIT,
    }),
  ]);

  const distinctNodeIds = Array.from(
    new Set(
      products
        .map((p) => p.taxonomyNodeId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  const nodes =
    distinctNodeIds.length === 0
      ? []
      : await prisma.taxonomyNode.findMany({
          where: { shopDomain },
        });
  const storeMode = (config.storeMode ?? "GENERAL") as StoreMode;
  const nodeAxesByNodeId: Record<string, AxisOptions> = {};
  for (const id of distinctNodeIds) {
    nodeAxesByNodeId[id] = getEffectiveAxes(id, nodes, storeMode);
  }

  return {
    mode: "DASHBOARD",
    storeMode: config.storeMode ?? "GENERAL",
    stats,
    products: products.map((p) => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      status: p.status,
      inventoryStatus: p.inventoryStatus,
      featuredImageUrl: p.featuredImageUrl,
      productType: p.productType,
      recommendationExcluded: p.recommendationExcluded,
      taxonomyNodeId: p.taxonomyNodeId,
      tags: p.tags.map((t) => ({
        axis: t.axis,
        value: t.value,
        source: t.source,
        locked: t.locked,
      })),
      tagStatus: computeTagStatus(p.tags.map((t) => t.source)),
    })),
    productLimit: PRODUCT_LIMIT,
    activeSyncJob: activeJob,
    nodeAxesByNodeId,
  };
}

async function resolveActiveSyncJob(
  shopDomain: string,
): Promise<ActiveSyncJob | null> {
  const job = await getActiveJobForShop(shopDomain);
  if (!job) return null;
  return {
    jobId: job.id,
    progress: job.processedProducts,
    total: job.totalProducts ?? 0,
    // Prefer startedAt for accuracy once the worker claims the job;
    // fall back to enqueuedAt while the job is still QUEUED so the UI
    // has a non-null timestamp to render.
    startedAt: (job.startedAt ?? job.enqueuedAt).toISOString(),
  };
}
