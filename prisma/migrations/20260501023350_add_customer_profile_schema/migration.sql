-- PR-D D.1: Customer profile schema + cron support columns + triggerSource
--
-- Hand-authored from `prisma migrate diff --from-schema-datasource ...
-- --to-schema-datamodel ...` output. The diff included a spurious
-- DROP INDEX "Product_embedding_cosine_idx" because Prisma's schema
-- DSL does not model pgvector IVFFlat indexes (the cosine index lives
-- in migration 20260426150000_add_pgvector_and_product_embedding and
-- is hand-maintained). The DROP has been omitted here; future
-- migrations that pass through `migrate diff` should continue to
-- strip it out unless intentionally rebuilding the index.

-- CreateEnum
CREATE TYPE "CustomerEventKind" AS ENUM (
    'PRODUCT_VIEWED',
    'PRODUCT_CLICKED',
    'ADD_TO_CART',
    'CHECKOUT_STARTED',
    'ORDER_PLACED',
    'LOOKBOOK_DOWNLOADED',
    'QUIZ_COMPLETED',
    'CHAT_STARTED',
    'CHAT_ENDED',
    'RECOMMENDATION_SHOWN',
    'RECOMMENDATION_CLICKED'
);

-- AlterTable: CatalogSyncJob.triggerSource (nullable; existing rows leave null)
ALTER TABLE "CatalogSyncJob" ADD COLUMN "triggerSource" TEXT;

-- AlterTable: MerchantConfig cron + timezone columns.
-- timezone defaults to 'UTC' so existing rows backfill cleanly without
-- a separate UPDATE; cron tick will refresh from Shopify lazily.
ALTER TABLE "MerchantConfig"
    ADD COLUMN "lastCronEnqueueDate" DATE,
    ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC',
    ADD COLUMN "timezoneSyncedAt" TIMESTAMP(3);

-- CreateTable: CustomerProfile
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "locale" TEXT,
    "gender" TEXT,
    "ageBand" TEXT,
    "region" TEXT,
    "conversationCount" INTEGER NOT NULL DEFAULT 0,
    "lastSessionAt" TIMESTAMP(3),
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpendCents" INTEGER NOT NULL DEFAULT 0,
    "predictedStyleCluster" TEXT,
    "aovBand" TEXT,
    "repurchasePredisposition" DOUBLE PRECISION,
    "originatedFromAgent" BOOLEAN NOT NULL DEFAULT false,
    "shopifyCreatedAt" TIMESTAMP(3),
    "shopifyUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomerProfileAttribute
CREATE TABLE "CustomerProfileAttribute" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "storeMode" "StoreMode" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfileAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomerSession
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "cookieSessionId" TEXT NOT NULL,
    "profileId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomerEvent (append-only behavioral stream)
CREATE TABLE "CustomerEvent" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "profileId" TEXT,
    "sessionId" TEXT,
    "kind" "CustomerEventKind" NOT NULL,
    "context" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerEvent_pkey" PRIMARY KEY ("id")
);

-- Indexes: CustomerProfile
CREATE INDEX "CustomerProfile_shopDomain_email_idx" ON "CustomerProfile"("shopDomain", "email");
CREATE INDEX "CustomerProfile_shopDomain_phone_idx" ON "CustomerProfile"("shopDomain", "phone");
CREATE INDEX "CustomerProfile_shopDomain_deletedAt_idx" ON "CustomerProfile"("shopDomain", "deletedAt");
CREATE UNIQUE INDEX "CustomerProfile_shopDomain_shopifyCustomerId_key" ON "CustomerProfile"("shopDomain", "shopifyCustomerId");

-- Indexes: CustomerProfileAttribute
CREATE INDEX "CustomerProfileAttribute_shopDomain_storeMode_key_value_idx" ON "CustomerProfileAttribute"("shopDomain", "storeMode", "key", "value");
CREATE UNIQUE INDEX "CustomerProfileAttribute_profileId_storeMode_key_key" ON "CustomerProfileAttribute"("profileId", "storeMode", "key");

-- Indexes: CustomerSession
CREATE INDEX "CustomerSession_profileId_idx" ON "CustomerSession"("profileId");
CREATE UNIQUE INDEX "CustomerSession_shopDomain_cookieSessionId_key" ON "CustomerSession"("shopDomain", "cookieSessionId");

-- Indexes: CustomerEvent
CREATE INDEX "CustomerEvent_shopDomain_profileId_occurredAt_idx" ON "CustomerEvent"("shopDomain", "profileId", "occurredAt");
CREATE INDEX "CustomerEvent_shopDomain_sessionId_occurredAt_idx" ON "CustomerEvent"("shopDomain", "sessionId", "occurredAt");
CREATE INDEX "CustomerEvent_shopDomain_kind_occurredAt_idx" ON "CustomerEvent"("shopDomain", "kind", "occurredAt");

-- Foreign keys
ALTER TABLE "CustomerProfileAttribute" ADD CONSTRAINT "CustomerProfileAttribute_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CustomerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerEvent" ADD CONSTRAINT "CustomerEvent_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "CustomerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerEvent" ADD CONSTRAINT "CustomerEvent_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "CustomerSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
