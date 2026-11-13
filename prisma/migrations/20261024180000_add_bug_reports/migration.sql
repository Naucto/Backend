-- CreateEnum
CREATE TYPE "BugCategory" AS ENUM ('GAMEPLAY', 'EDITOR', 'GRAPHICS', 'SOUND', 'NETPLAY', 'ACCOUNT', 'PERFORMANCE', 'OTHER');

-- AlterEnum
ALTER TYPE "ReportKind" ADD VALUE 'BUG';

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "appRelease" TEXT,
ADD COLUMN     "category" "BugCategory",
ADD COLUMN     "context" JSONB,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "projectId" INTEGER,
ADD COLUMN     "ratingId" INTEGER,
ADD COLUMN     "screenshotBytes" INTEGER,
ADD COLUMN     "screenshotKey" TEXT,
ADD COLUMN     "screenshotMime" TEXT,
ADD COLUMN     "title" TEXT;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_ratingId_fkey" FOREIGN KEY ("ratingId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

