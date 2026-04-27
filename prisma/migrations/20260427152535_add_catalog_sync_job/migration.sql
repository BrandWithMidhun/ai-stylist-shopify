-- CreateEnum
CREATE TYPE "CatalogSyncJobKind" AS ENUM ('INITIAL', 'MANUAL_RESYNC', 'DELTA');

-- CreateEnum
CREATE TYPE "CatalogSyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CatalogSyncJobPhase" AS ENUM ('COLLECTIONS', 'METAOBJECTS', 'PRODUCTS', 'FINALIZE');

-- NOTE: Prisma re-generates DROP INDEX "Product_embedding_cosine_idx" on
-- every migration because the IVFFlat index lives on an Unsupported
-- vector column it can't represent. Removed; see add_knowledge_record.

-- CreateTable
CREATE TABLE "CatalogSyncJob" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "kind" "CatalogSyncJobKind" NOT NULL,
    "status" "CatalogSyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" "CatalogSyncJobPhase",
    "totalProducts" INTEGER,
    "processedProducts" INTEGER NOT NULL DEFAULT 0,
    "failedProducts" INTEGER NOT NULL DEFAULT 0,
    "totalCollections" INTEGER,
    "processedCollections" INTEGER NOT NULL DEFAULT 0,
    "totalMetaobjects" INTEGER,
    "processedMetaobjects" INTEGER NOT NULL DEFAULT 0,
    "productsCursor" TEXT,
    "metaobjectsCursor" TEXT,
    "collectionsCursor" TEXT,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSyncJobFailure" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "shopifyGid" TEXT,
    "message" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogSyncJobFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogSyncJob_shopDomain_status_idx" ON "CatalogSyncJob"("shopDomain", "status");

-- CreateIndex
CREATE INDEX "CatalogSyncJob_shopDomain_kind_status_idx" ON "CatalogSyncJob"("shopDomain", "kind", "status");

-- CreateIndex
CREATE INDEX "CatalogSyncJob_heartbeatAt_idx" ON "CatalogSyncJob"("heartbeatAt");

-- CreateIndex
CREATE INDEX "CatalogSyncJobFailure_jobId_idx" ON "CatalogSyncJobFailure"("jobId");

-- CreateIndex
CREATE INDEX "CatalogSyncJobFailure_shopDomain_occurredAt_idx" ON "CatalogSyncJobFailure"("shopDomain", "occurredAt");

-- AddForeignKey
ALTER TABLE "CatalogSyncJobFailure" ADD CONSTRAINT "CatalogSyncJobFailure_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CatalogSyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: at most one RUNNING job per shop. Prisma's
-- `@@unique` doesn't support WHERE clauses, so this is hand-added.
-- The sync-jobs library's claimNextJob also enforces this via NOT EXISTS,
-- but the DB-level constraint is the safety net against bugs and races.
CREATE UNIQUE INDEX "CatalogSyncJob_one_running_per_shop"
  ON "CatalogSyncJob"("shopDomain")
  WHERE "status" = 'RUNNING';
