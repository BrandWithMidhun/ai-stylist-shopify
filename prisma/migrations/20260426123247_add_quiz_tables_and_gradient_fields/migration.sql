-- CreateEnum
CREATE TYPE "QuizState" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- AlterTable
ALTER TABLE "MerchantConfig" ADD COLUMN     "chatPrimaryColorEnd" TEXT,
ADD COLUMN     "chatPrimaryGradientAngle" INTEGER NOT NULL DEFAULT 135;

-- CreateTable
CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "storeMode" "StoreMode" NOT NULL,
    "state" "QuizState" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "currentQuestionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAnswer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answerKey" TEXT,
    "answerKeys" TEXT[],
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuizSession_shopDomain_sessionId_idx" ON "QuizSession"("shopDomain", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizSession_shopDomain_sessionId_storeMode_key" ON "QuizSession"("shopDomain", "sessionId", "storeMode");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAnswer_sessionId_questionKey_key" ON "QuizAnswer"("sessionId", "questionKey");

-- AddForeignKey
ALTER TABLE "QuizAnswer" ADD CONSTRAINT "QuizAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "QuizSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
