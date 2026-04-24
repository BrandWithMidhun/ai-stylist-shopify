-- AlterTable
ALTER TABLE "MerchantConfig" ADD COLUMN     "lastFullSyncAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "descriptionHtml" TEXT,
    "productType" TEXT,
    "vendor" TEXT,
    "status" TEXT NOT NULL,
    "featuredImageUrl" TEXT,
    "imageUrls" TEXT[],
    "priceMin" DECIMAL(65,30),
    "priceMax" DECIMAL(65,30),
    "currency" TEXT,
    "shopifyTags" TEXT[],
    "totalInventory" INTEGER,
    "inventoryStatus" TEXT NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3) NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(65,30) NOT NULL,
    "compareAtPrice" DECIMAL(65,30),
    "inventoryQuantity" INTEGER,
    "inventoryItemId" TEXT,
    "availableForSale" BOOLEAN NOT NULL,
    "option1" TEXT,
    "option2" TEXT,
    "option3" TEXT,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTag" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTagAudit" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "axis" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTagAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_shopDomain_status_idx" ON "Product"("shopDomain", "status");

-- CreateIndex
CREATE INDEX "Product_shopDomain_inventoryStatus_idx" ON "Product"("shopDomain", "inventoryStatus");

-- CreateIndex
CREATE INDEX "Product_shopDomain_productType_idx" ON "Product"("shopDomain", "productType");

-- CreateIndex
CREATE INDEX "Product_shopDomain_deletedAt_idx" ON "Product"("shopDomain", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shopDomain_shopifyId_key" ON "Product"("shopDomain", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "ProductVariant_inventoryItemId_idx" ON "ProductVariant"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_shopifyId_key" ON "ProductVariant"("productId", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductTag_shopDomain_axis_value_idx" ON "ProductTag"("shopDomain", "axis", "value");

-- CreateIndex
CREATE INDEX "ProductTag_productId_idx" ON "ProductTag"("productId");

-- CreateIndex
CREATE INDEX "ProductTag_shopDomain_source_idx" ON "ProductTag"("shopDomain", "source");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTag_productId_axis_value_key" ON "ProductTag"("productId", "axis", "value");

-- CreateIndex
CREATE INDEX "ProductTagAudit_productId_createdAt_idx" ON "ProductTagAudit"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductTagAudit_shopDomain_createdAt_idx" ON "ProductTagAudit"("shopDomain", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTag" ADD CONSTRAINT "ProductTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
