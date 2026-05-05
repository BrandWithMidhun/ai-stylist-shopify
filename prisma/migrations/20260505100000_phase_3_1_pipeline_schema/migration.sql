-- PR-3.1-mech.1: Phase 3 Sub-bundle 3.1 — pipeline schema additions
--
-- Hand-authored. Strictly additive: no column drops, no rewrites of
-- existing rows beyond the boolean default backfill. Apply only on
-- Railway via `prisma migrate deploy`. Per CLAUDE.md operational
-- notes + HANDOFF:48 migration discipline, this file MUST NOT be
-- applied via `prisma migrate dev`.
--
-- Per HANDOFF:719 IVFFlat discipline, any future `prisma migrate diff`
-- pass through this state will continue to report
--   DROP INDEX "Product_embedding_cosine_idx"
-- as drift because the IVFFlat index is unmodellable in Prisma DSL
-- and lives only in migration 20260426150000_add_pgvector_and_product_embedding.
-- The DROP must always be stripped from any new migration SQL — it is
-- the canonical known-exception for this repo.
--
-- Order:
--   1. Extend TaggingJobKind enum with RE_EMBED. The TaggingJob queue
--      now also serves as the embedding queue (cost ledger, heartbeat,
--      dedup, error class taxonomy all match Voyage work shape exactly).
--      Naming debt: the model is no longer tagging-only; rename is a
--      future cleanup, NOT 3.1 scope. Recorded in HANDOFF.
--   2. Add Product.recommendationPromoted column (default false). Stage
--      4 of the v2 pipeline reads it. Sibling to recommendationExcluded.
--      No index in 3.1 — Stage 4 reads on the candidate set already
--      narrowed by Stages 1+2 (~30-100 products), no shop-wide scan.
--   3. Create EvalQueryMode enum. Mirrors StoreMode values; kept
--      separate so EvalQuery's mode (fixture metadata) can diverge
--      from the merchant's storeMode in the future without coupling.
--   4. Create RecommendationEvent table + indexes + FKs.
--      Schema lands now; writes happen in mech.6. 3.2 reads these
--      rows for AI revenue attribution per brief §7.
--   5. Create EvalQuery + EvalRun + EvalResult tables + indexes + FKs.
--      Pipeline-quality eval. EvalFixture (tag-quality eval) deferred
--      to a future phase; `EvalRun.kind` discriminates so the future
--      addition is purely additive.

-- 1. Extend TaggingJobKind enum.
-- ALTER TYPE ... ADD VALUE is a Postgres 12+ in-tx-safe operation as
-- long as the new value isn't referenced in the same transaction.
-- This migration does not insert or query rows with kind='RE_EMBED';
-- the worker handler that uses it lands in mech.6.
ALTER TYPE "TaggingJobKind" ADD VALUE 'RE_EMBED';

-- 2. Product.recommendationPromoted column. Default false; existing
-- rows pick up the default in the ADD COLUMN pass.
ALTER TABLE "Product" ADD COLUMN "recommendationPromoted" BOOLEAN NOT NULL DEFAULT false;

-- 3. EvalQueryMode enum.
CREATE TYPE "EvalQueryMode" AS ENUM (
    'FASHION',
    'ELECTRONICS',
    'FURNITURE',
    'BEAUTY',
    'JEWELLERY',
    'GENERAL'
);

-- 4. RecommendationEvent.
CREATE TABLE "RecommendationEvent" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "profileId" TEXT,
    "sessionId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "candidates" JSONB NOT NULL,
    "trace" JSONB NOT NULL,
    "traceVersion" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "topDistance" DOUBLE PRECISION,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecommendationEvent_shopDomain_profileId_createdAt_idx"
    ON "RecommendationEvent"("shopDomain", "profileId", "createdAt");
CREATE INDEX "RecommendationEvent_shopDomain_sessionId_createdAt_idx"
    ON "RecommendationEvent"("shopDomain", "sessionId", "createdAt");
CREATE INDEX "RecommendationEvent_shopDomain_traceVersion_createdAt_idx"
    ON "RecommendationEvent"("shopDomain", "traceVersion", "createdAt");
CREATE INDEX "RecommendationEvent_shopDomain_createdAt_idx"
    ON "RecommendationEvent"("shopDomain", "createdAt");

ALTER TABLE "RecommendationEvent"
    ADD CONSTRAINT "RecommendationEvent_profileId_fkey"
        FOREIGN KEY ("profileId") REFERENCES "CustomerProfile"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecommendationEvent"
    ADD CONSTRAINT "RecommendationEvent_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "CustomerSession"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

-- 5a. EvalQuery.
CREATE TABLE "EvalQuery" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "fixtureKey" TEXT NOT NULL,
    "mode" "EvalQueryMode" NOT NULL,
    "intent" TEXT NOT NULL,
    "expectedHandles" TEXT[] NOT NULL,
    "expectedTagFilters" JSONB NOT NULL,
    "k" INTEGER NOT NULL DEFAULT 6,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvalQuery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvalQuery_shopDomain_fixtureKey_key"
    ON "EvalQuery"("shopDomain", "fixtureKey");
CREATE INDEX "EvalQuery_shopDomain_mode_idx"
    ON "EvalQuery"("shopDomain", "mode");

-- 5b. EvalRun.
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "totalQueries" INTEGER NOT NULL,
    "passCount" INTEGER NOT NULL,
    "partialCount" INTEGER NOT NULL,
    "failCount" INTEGER NOT NULL,
    "aggregateScore" DOUBLE PRECISION NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "gitSha" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvalRun_shopDomain_kind_createdAt_idx"
    ON "EvalRun"("shopDomain", "kind", "createdAt");
CREATE INDEX "EvalRun_shopDomain_pipelineVersion_createdAt_idx"
    ON "EvalRun"("shopDomain", "pipelineVersion", "createdAt");

-- 5c. EvalResult.
CREATE TABLE "EvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "precisionAtK" DOUBLE PRECISION NOT NULL,
    "relaxedMatchAtK" DOUBLE PRECISION NOT NULL,
    "topKHandles" TEXT[] NOT NULL,
    "topKTagsJson" JSONB NOT NULL,
    "pipelineLatencyMs" INTEGER NOT NULL,
    "recommendationEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvalResult_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvalResult_runId_idx" ON "EvalResult"("runId");
CREATE INDEX "EvalResult_queryId_createdAt_idx"
    ON "EvalResult"("queryId", "createdAt");

ALTER TABLE "EvalResult"
    ADD CONSTRAINT "EvalResult_runId_fkey"
        FOREIGN KEY ("runId") REFERENCES "EvalRun"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalResult"
    ADD CONSTRAINT "EvalResult_queryId_fkey"
        FOREIGN KEY ("queryId") REFERENCES "EvalQuery"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
