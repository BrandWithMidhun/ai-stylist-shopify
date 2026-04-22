-- CreateEnum
CREATE TYPE "StoreMode" AS ENUM ('FASHION', 'ELECTRONICS', 'FURNITURE', 'BEAUTY', 'GENERAL');

-- CreateEnum
CREATE TYPE "CtaPlacement" AS ENUM ('PRODUCT_PAGE', 'GLOBAL', 'COLLECTION');

-- CreateTable
CREATE TABLE "MerchantConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "storeMode" "StoreMode" NOT NULL DEFAULT 'GENERAL',
    "chatWidgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ctaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ctaLabel" TEXT NOT NULL DEFAULT 'Need help choosing?',
    "ctaPlacement" "CtaPlacement" NOT NULL DEFAULT 'PRODUCT_PAGE',
    "quizEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lookbookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "stylistAgentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "commerceAgentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MerchantConfig_shop_key" ON "MerchantConfig"("shop");
