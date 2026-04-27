-- NOTE: Prisma's `prisma migrate dev` initially generated
--   DROP INDEX "Product_embedding_cosine_idx";
-- because that IVFFlat index was created via raw SQL in
-- 20260426150000_add_pgvector_and_product_embedding against the
-- Unsupported("vector(1024)") column, which Prisma can't represent in
-- schema.prisma. Each subsequent generated migration will try to drop
-- it again. We remove the DROP from generated migrations so the
-- similarity-search index is preserved across deploys.

-- AlterTable
ALTER TABLE "MerchantConfig" ADD COLUMN     "lastKnowledgeSyncAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "descriptionText" TEXT,
ADD COLUMN     "embeddingContentHash" TEXT,
ADD COLUMN     "knowledgeContentHash" TEXT,
ADD COLUMN     "knowledgeContentHashAt" TIMESTAMP(3),
ADD COLUMN     "lastKnowledgeSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductMetafield" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "referenceGid" TEXT,
    "shopifyMetafieldId" TEXT NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMetafield_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metaobject" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "handle" TEXT,
    "displayName" TEXT,
    "fields" JSONB NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Metaobject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionHtml" TEXT,
    "descriptionText" TEXT,
    "sortOrder" TEXT,
    "isSmart" BOOLEAN NOT NULL DEFAULT false,
    "templateSuffix" TEXT,
    "shopifyUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCollection" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductMetafield_shopDomain_namespace_key_idx" ON "ProductMetafield"("shopDomain", "namespace", "key");

-- CreateIndex
CREATE INDEX "ProductMetafield_productId_idx" ON "ProductMetafield"("productId");

-- CreateIndex
CREATE INDEX "ProductMetafield_referenceGid_idx" ON "ProductMetafield"("referenceGid");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMetafield_productId_namespace_key_key" ON "ProductMetafield"("productId", "namespace", "key");

-- CreateIndex
CREATE INDEX "Metaobject_shopDomain_type_idx" ON "Metaobject"("shopDomain", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Metaobject_shopDomain_shopifyId_key" ON "Metaobject"("shopDomain", "shopifyId");

-- CreateIndex
CREATE INDEX "Collection_shopDomain_handle_idx" ON "Collection"("shopDomain", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_shopDomain_shopifyId_key" ON "Collection"("shopDomain", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductCollection_collectionId_idx" ON "ProductCollection"("collectionId");

-- CreateIndex
CREATE INDEX "ProductCollection_shopDomain_collectionId_idx" ON "ProductCollection"("shopDomain", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCollection_productId_collectionId_key" ON "ProductCollection"("productId", "collectionId");

-- CreateIndex
CREATE INDEX "Product_shopDomain_priceMin_idx" ON "Product"("shopDomain", "priceMin");

-- AddForeignKey
ALTER TABLE "ProductMetafield" ADD CONSTRAINT "ProductMetafield_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCollection" ADD CONSTRAINT "ProductCollection_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
