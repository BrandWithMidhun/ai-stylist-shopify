// Shared loader helpers for the intelligence dashboard route.
//
// Keeps app/routes/app.products.intelligence.tsx thin by pulling the product
// list + mode branching logic into a server-only helper.

import prisma from "../../db.server";
import { computeTagStatus, type TagStatus } from "./tag-status";
import { getActiveJobId, getJob } from "./jobs.server";
import {
  loadDashboardStats,
  type DashboardStats,
} from "./stats.server";

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
    };

export async function loadIntelligenceData(
  shopDomain: string,
): Promise<IntelligenceLoaderData> {
  const config = await prisma.merchantConfig.findUnique({
    where: { shop: shopDomain },
    select: { lastFullSyncAt: true, storeMode: true },
  });

  const activeJob = resolveActiveSyncJob(shopDomain);

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
  };
}

function resolveActiveSyncJob(shopDomain: string): ActiveSyncJob | null {
  const jobId = getActiveJobId(shopDomain, "sync");
  if (!jobId) return null;
  const job = getJob(jobId);
  if (!job) return null;
  if (job.status !== "running" && job.status !== "queued") return null;
  return {
    jobId: job.id,
    progress: job.progress,
    total: job.total,
    startedAt: job.startedAt.toISOString(),
  };
}
