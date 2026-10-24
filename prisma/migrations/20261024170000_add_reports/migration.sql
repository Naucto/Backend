-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('RATING');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReportRole" AS ENUM ('PLAYER', 'CREATOR');

-- CreateEnum
CREATE TYPE "RatingOrigin" AS ENUM ('PROMPT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RatingReason" AS ENUM ('BUGS', 'PERFORMANCE', 'HARD_TO_USE', 'MISSING_FEATURE', 'CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackPromptStatus" AS ENUM ('ANSWERED', 'DECLINED', 'SNOOZED');

-- CreateTable
CREATE TABLE "Report" (
    "id" SERIAL NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'NEW',
    "userId" INTEGER,
    "role" "ReportRole",
    "route" TEXT,
    "releaseId" INTEGER,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "score" INTEGER,
    "reasons" "RatingReason"[] DEFAULT ARRAY[]::"RatingReason"[],
    "liked" TEXT,
    "improve" TEXT,
    "origin" "RatingOrigin",

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackPrompt" (
    "userId" INTEGER NOT NULL,
    "status" "FeedbackPromptStatus" NOT NULL,
    "snoozedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackPrompt_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "Report_kind_createdAt_idx" ON "Report"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Report_kind_status_createdAt_idx" ON "Report"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_userId_idx" ON "Report"("userId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackPrompt" ADD CONSTRAINT "FeedbackPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

