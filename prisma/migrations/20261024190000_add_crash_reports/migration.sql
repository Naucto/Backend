-- CreateEnum
CREATE TYPE "CrashSource" AS ENUM ('WEB', 'ENGINE', 'BACKEND');

-- AlterEnum
ALTER TYPE "ReportKind" ADD VALUE 'CRASH';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "count" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "groupKey" TEXT,
ADD COLUMN     "lastSeen" TIMESTAMP(3),
ADD COLUMN     "regressedAt" TIMESTAMP(3),
ADD COLUMN     "source" "CrashSource",
ADD COLUMN     "stack" TEXT;

-- CreateTable
CREATE TABLE "ReportOccurrence" (
    "id" SERIAL NOT NULL,
    "reportId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT NOT NULL,
    "stack" TEXT NOT NULL,
    "appRelease" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "extra" JSONB,

    CONSTRAINT "ReportOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportOccurrence_reportId_createdAt_idx" ON "ReportOccurrence"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "Report_kind_lastSeen_idx" ON "Report"("kind", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "Report_kind_groupKey_key" ON "Report"("kind", "groupKey");

-- AddForeignKey
ALTER TABLE "ReportOccurrence" ADD CONSTRAINT "ReportOccurrence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

