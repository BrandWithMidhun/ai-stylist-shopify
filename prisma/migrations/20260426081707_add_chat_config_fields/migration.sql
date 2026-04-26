-- AlterTable
ALTER TABLE "MerchantConfig" ADD COLUMN     "chatPrimaryColor" TEXT NOT NULL DEFAULT '#000000',
ADD COLUMN     "chatWelcomeMessage" TEXT NOT NULL DEFAULT 'Hi! I''m your shopping assistant. How can I help you today?';
