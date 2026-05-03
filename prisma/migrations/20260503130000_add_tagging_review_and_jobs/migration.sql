-- PR-2.1: Tagging review state machine + TaggingJob queue + budget tripwires
--
-- Hand-authored from `prisma migrate diff --from-schema-datasource ...
-- --to-schema-datamodel ... --script` output. The diff included a spurious
-- DROP INDEX "Product_embedding_cosine_idx" because Prisma's schema DSL
-- does not model pgvector IVFFlat indexes (the cosine index lives in
-- migration 20260426150000_add_pgvector_and_product_embedding and is
-- hand-maintained). The DROP has been omitted here; future migrations
-- that pass through `migrate diff` should continue to strip it out
-- unless intentionally rebuilding the index.
--
-- Two additions beyond the diff output:
--   1. Partial unique indexes on TaggingJob — Prisma DSL cannot express
--      a WHERE clause on @@unique, so they are added below in raw SQL.
--      Same pattern as CatalogSyncJob's "at most one RUNNING per shop"
--      partial unique index from migration 20260427152535.
--   2. One-time data backfill for ProductTag.status — pre-existing rows
--      with source='HUMAN' are flipped to status='APPROVED' so the
--      mark-reviewed history is preserved across the schema change.
--      Predicate is exactly source='HUMAN'; no broader rewrite.

-- CreateEnum: review state for ProductTag rows.
CREATE TYPE "TagReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum: tagging job kinds.
CREATE TYPE "TaggingJobKind" AS ENUM ('SINGLE_PRODUCT', 'INITIAL_BACKFILL', 'MANUAL_RETAG');

-- CreateEnum: tagging job statuses (mirrors CatalogSyncJobStatus + BUDGET_PAUSED).
CREATE TYPE "TaggingJobStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'BUDGET_PAUSED'
);

-- AlterTable: MerchantConfig budget tripwires. Both nullable, default
-- NULL — set when a daily cap crossing is detected, cleared when the
-- next day rolls over.
ALTER TABLE "MerchantConfig"
    ADD COLUMN "taggingBudgetExceededAt" TIMESTAMP(3),
    ADD COLUMN "taggingBudgetWarnedAt"   TIMESTAMP(3);

-- AlterTable: ProductTag review state columns.
-- status defaults to PENDING_REVIEW for new rows; existing rows pick up
-- the default on column add (Postgres ADD COLUMN ... NOT NULL DEFAULT
-- writes the default to every existing row in one pass).
ALTER TABLE "ProductTag"
    ADD COLUMN "reviewedAt" TIMESTAMP(3),
    ADD COLUMN "reviewedBy" TEXT,
    ADD COLUMN "status"     "TagReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW';

-- One-time data backfill: pre-existing source='HUMAN' tags are
-- merchant-authored and implicitly approved. Predicate must be EXACTLY
-- source='HUMAN' — no broader UPDATE. AI and RULE rows stay
-- PENDING_REVIEW (AI) or get flipped to APPROVED only when the
-- rule-engine code in PR-2.1 writes new rule tags going forward.
-- Existing RULE rows from before this migration stay PENDING_REVIEW;
-- the next rule-engine write per product upserts and lifts them.
UPDATE "ProductTag" SET "status" = 'APPROVED' WHERE "source" = 'HUMAN';

-- CreateTable: TaggingJob.
CREATE TABLE "TaggingJob" (
    "id"                TEXT             NOT NULL,
    "shopDomain"        TEXT             NOT NULL,
    "productId"         TEXT,
    "kind"              "TaggingJobKind" NOT NULL,
    "status"            "TaggingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "triggerSource"     TEXT             NOT NULL,
    "enqueuedAt"        TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"         TIMESTAMP(3),
    "finishedAt"        TIMESTAMP(3),
    "heartbeatAt"       TIMESTAMP(3),
    "totalProducts"     INTEGER,
    "processedProducts" INTEGER          NOT NULL DEFAULT 0,
    "failedProducts"    INTEGER          NOT NULL DEFAULT 0,
    "skippedProducts"   INTEGER          NOT NULL DEFAULT 0,
    "costUsdMicros"     BIGINT           NOT NULL DEFAULT 0,
    "inputTokens"       INTEGER          NOT NULL DEFAULT 0,
    "outputTokens"      INTEGER          NOT NULL DEFAULT 0,
    "errorClass"        TEXT,
    "errorMessage"      TEXT,
    "errorCount"        INTEGER          NOT NULL DEFAULT 0,
    "summary"           JSONB,
    "createdAt"         TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "TaggingJob_pkey" PRIMARY KEY ("id")
);

-- Indexes: TaggingJob.
CREATE INDEX "TaggingJob_shopDomain_status_idx"      ON "TaggingJob"("shopDomain", "status");
CREATE INDEX "TaggingJob_shopDomain_kind_status_idx" ON "TaggingJob"("shopDomain", "kind", "status");
CREATE INDEX "TaggingJob_heartbeatAt_idx"            ON "TaggingJob"("heartbeatAt");
CREATE INDEX "TaggingJob_shopDomain_productId_idx"   ON "TaggingJob"("shopDomain", "productId");

-- Partial unique indexes (raw SQL — not expressible in Prisma DSL).
-- 1) QUEUED-only dedup for SINGLE_PRODUCT / MANUAL_RETAG: at most one
--    QUEUED row per (shopDomain, productId). RUNNING rows are not
--    considered for dedup because a RUNNING DELTA's prompt window may
--    have already paginated past the product — same correctness
--    rationale as CatalogSyncJob's QUEUED-only dedup (PR-C).
CREATE UNIQUE INDEX "TaggingJob_shopDomain_productId_queued_uniq"
    ON "TaggingJob"("shopDomain", "productId")
    WHERE "status" = 'QUEUED' AND "productId" IS NOT NULL;

-- 2) At most one INITIAL_BACKFILL per shop in flight (QUEUED or RUNNING).
--    Mirrors CatalogSyncJob's RUNNING-singleton constraint, widened to
--    cover QUEUED too because a backfill takes hours and we never want
--    two queued at once.
CREATE UNIQUE INDEX "TaggingJob_shopDomain_initial_backfill_active_uniq"
    ON "TaggingJob"("shopDomain")
    WHERE "kind" = 'INITIAL_BACKFILL' AND "status" IN ('QUEUED', 'RUNNING');

-- Index: ProductTag.status for the review-queue scan in 2.3.
CREATE INDEX "ProductTag_shopDomain_status_idx" ON "ProductTag"("shopDomain", "status");
