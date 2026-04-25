-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "taxonomyNodeId" TEXT;

-- CreateTable
CREATE TABLE "TaxonomyNode" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "axisOverrides" JSONB NOT NULL,
    "matchKeywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxonomyNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaggingRule" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "taxonomyNodeId" TEXT,
    "conditions" JSONB NOT NULL,
    "effects" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaggingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaxonomyNode_shopDomain_parentId_idx" ON "TaxonomyNode"("shopDomain", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyNode_shopDomain_slug_key" ON "TaxonomyNode"("shopDomain", "slug");

-- CreateIndex
CREATE INDEX "TaggingRule_shopDomain_enabled_priority_idx" ON "TaggingRule"("shopDomain", "enabled", "priority");

-- CreateIndex
CREATE INDEX "Product_shopDomain_taxonomyNodeId_idx" ON "Product"("shopDomain", "taxonomyNodeId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_taxonomyNodeId_fkey" FOREIGN KEY ("taxonomyNodeId") REFERENCES "TaxonomyNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyNode" ADD CONSTRAINT "TaxonomyNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaxonomyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
