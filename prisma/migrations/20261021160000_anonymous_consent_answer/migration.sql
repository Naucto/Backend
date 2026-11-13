-- CreateEnum
CREATE TYPE "AnalyticsAnonConsent" AS ENUM ('DECLINED', 'UNANSWERED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "AnalyticsAnonTally" DROP CONSTRAINT "AnalyticsAnonTally_pkey",
ADD COLUMN     "consent" "AnalyticsAnonConsent" NOT NULL DEFAULT 'UNKNOWN',
ADD CONSTRAINT "AnalyticsAnonTally_pkey" PRIMARY KEY ("minute", "state", "signedIn", "releaseId", "consent");
