-- CreateEnum
CREATE TYPE "AnalyticsLiveState" AS ENUM ('BROWSING', 'BUILDING', 'PLAYING', 'HOSTING');

-- CreateEnum
CREATE TYPE "AnalyticsFactType" AS ENUM ('SIGNUP', 'PROJECT_CREATED', 'RELEASE_PUBLISHED', 'RELEASE_UPDATED', 'RELEASE_UNPUBLISHED');

-- CreateEnum
CREATE TYPE "AnalyticsGrain" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "AnalyticsRollupState" AS ENUM ('FINAL', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "AnalyticsRetentionKind" AS ENUM ('VISITOR', 'ACCOUNT');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "releaseContentHash" TEXT,
ADD COLUMN     "releaseRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AnalyticsVisitor" (
    "id" UUID NOT NULL,
    "userId" INTEGER,
    "linkedAt" TIMESTAMP(3),
    "projectedThrough" DATE,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsVisitorTombstone" (
    "id" UUID NOT NULL,
    "erasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsVisitorTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" UUID NOT NULL,
    "visitorId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "referrerDomain" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "device" TEXT NOT NULL,
    "browser" TEXT,
    "os" TEXT,
    "country" CHAR(2),
    "screen" TEXT,
    "language" TEXT,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSessionDay" (
    "sessionId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "activeBits" BYTEA NOT NULL,
    "buildBits" BYTEA NOT NULL,
    "playMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsSessionDay_pkey" PRIMARY KEY ("sessionId","day")
);

-- CreateTable
CREATE TABLE "AnalyticsPageView" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "route" TEXT NOT NULL,

    CONSTRAINT "AnalyticsPageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsPlay" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "releaseId" INTEGER NOT NULL,
    "continued" BOOLEAN NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "activeMs" BIGINT NOT NULL DEFAULT 0,
    "baselineMs" BIGINT NOT NULL DEFAULT 0,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "AnalyticsPlay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsPlayDay" (
    "playId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "activeMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsPlayDay_pkey" PRIMARY KEY ("playId","day")
);

-- CreateTable
CREATE TABLE "AnalyticsLiveMinute" (
    "minute" TIMESTAMP(3) NOT NULL,
    "visitorId" UUID NOT NULL,
    "state" "AnalyticsLiveState" NOT NULL,
    "releaseId" INTEGER,

    CONSTRAINT "AnalyticsLiveMinute_pkey" PRIMARY KEY ("minute","visitorId")
);

-- CreateTable
CREATE TABLE "AnalyticsAnonTally" (
    "minute" TIMESTAMP(3) NOT NULL,
    "state" "AnalyticsLiveState" NOT NULL,
    "signedIn" BOOLEAN NOT NULL,
    "releaseId" INTEGER NOT NULL DEFAULT 0,
    "beats" INTEGER NOT NULL DEFAULT 0,
    "playsStarted" INTEGER NOT NULL DEFAULT 0,
    "playMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsAnonTally_pkey" PRIMARY KEY ("minute","state","signedIn","releaseId")
);

-- CreateTable
CREATE TABLE "AnalyticsFact" (
    "id" BIGSERIAL NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "AnalyticsFactType" NOT NULL,
    "actorUserId" INTEGER,
    "projectId" INTEGER,

    CONSTRAINT "AnalyticsFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsMpSession" (
    "id" UUID NOT NULL,
    "projectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editorTest" BOOLEAN NOT NULL DEFAULT false,
    "classifiedAt" TIMESTAMP(3),
    "firstConnectedAt" TIMESTAMP(3),
    "reachedMultiAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "peakConnected" INTEGER NOT NULL DEFAULT 0,
    "multiMs" BIGINT NOT NULL DEFAULT 0,
    "playerMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsMpSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsMpSeat" (
    "sessionId" UUID NOT NULL,
    "seatToken" UUID NOT NULL,
    "firstConnectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsMpSeat_pkey" PRIMARY KEY ("sessionId","seatToken")
);

-- CreateTable
CREATE TABLE "AnalyticsMpDay" (
    "sessionId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "multiMs" BIGINT NOT NULL DEFAULT 0,
    "playerMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsMpDay_pkey" PRIMARY KEY ("sessionId","day")
);

-- CreateTable
CREATE TABLE "AnalyticsProjectionWork" (
    "visitorId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "AnalyticsProjectionWork_pkey" PRIMARY KEY ("visitorId")
);

-- CreateTable
CREATE TABLE "ConcurrencySample" (
    "at" TIMESTAMP(3) NOT NULL,
    "activeBrowsers" INTEGER NOT NULL,
    "activeBrowsersPlaying" INTEGER NOT NULL,
    "activeBrowsersBuilding" INTEGER NOT NULL,
    "activeBrowsersHosting" INTEGER NOT NULL,
    "anonTabs" INTEGER NOT NULL,
    "anonTabsPlaying" INTEGER NOT NULL,
    "anonTabsBuilding" INTEGER NOT NULL,
    "anonTabsHosting" INTEGER NOT NULL,
    "accounts" INTEGER NOT NULL,
    "accountsPlaying" INTEGER NOT NULL,
    "accountsBuilding" INTEGER NOT NULL,
    "accountsHosting" INTEGER NOT NULL,

    CONSTRAINT "ConcurrencySample_pkey" PRIMARY KEY ("at")
);

-- CreateTable
CREATE TABLE "AnalyticsIngestStat" (
    "minute" TIMESTAMP(3) NOT NULL,
    "instanceId" TEXT NOT NULL,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "throttled" INTEGER NOT NULL DEFAULT 0,
    "writeErrors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsIngestStat_pkey" PRIMARY KEY ("minute","instanceId")
);

-- CreateTable
CREATE TABLE "AnalyticsRollup" (
    "metric" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "grain" "AnalyticsGrain" NOT NULL,
    "periodStart" DATE NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AnalyticsRollup_pkey" PRIMARY KEY ("metric","version","grain","periodStart","dimension")
);

-- CreateTable
CREATE TABLE "AnalyticsRollupStatus" (
    "metric" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "grain" "AnalyticsGrain" NOT NULL,
    "periodStart" DATE NOT NULL,
    "status" "AnalyticsRollupState" NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "samplerCoverage" DOUBLE PRECISION NOT NULL,
    "ingestErrorRate" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "AnalyticsRollupStatus_pkey" PRIMARY KEY ("metric","version","grain","periodStart")
);

-- CreateTable
CREATE TABLE "AnalyticsCohort" (
    "kind" "AnalyticsRetentionKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "cohortDay" DATE NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "retained" INTEGER,
    "mature" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalyticsCohort_pkey" PRIMARY KEY ("kind","version","cohortDay","offsetDays")
);

-- CreateTable
CREATE TABLE "AnalyticsUserDaily" (
    "userId" INTEGER NOT NULL,
    "visitorId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "releaseId" INTEGER NOT NULL DEFAULT 0,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "activeMs" BIGINT NOT NULL DEFAULT 0,
    "activeMinutes" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsUserDaily_pkey" PRIMARY KEY ("userId","visitorId","day","releaseId")
);

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_userId_idx" ON "AnalyticsVisitor"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_firstSeenAt_idx" ON "AnalyticsVisitor"("firstSeenAt");

-- CreateIndex
CREATE INDEX "AnalyticsVisitor_lastSeenAt_idx" ON "AnalyticsVisitor"("lastSeenAt");

-- CreateIndex
CREATE INDEX "AnalyticsVisitorTombstone_erasedAt_idx" ON "AnalyticsVisitorTombstone"("erasedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_startedAt_idx" ON "AnalyticsSession"("startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_visitorId_startedAt_idx" ON "AnalyticsSession"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSession_closedAt_idx" ON "AnalyticsSession"("closedAt");

-- CreateIndex
CREATE INDEX "AnalyticsSessionDay_day_idx" ON "AnalyticsSessionDay"("day");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_occurredAt_idx" ON "AnalyticsPageView"("occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsPageView_sessionId_idx" ON "AnalyticsPageView"("sessionId");

-- CreateIndex
CREATE INDEX "AnalyticsPlay_startedAt_idx" ON "AnalyticsPlay"("startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsPlay_sessionId_idx" ON "AnalyticsPlay"("sessionId");

-- CreateIndex
CREATE INDEX "AnalyticsPlay_releaseId_startedAt_idx" ON "AnalyticsPlay"("releaseId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsPlayDay_day_idx" ON "AnalyticsPlayDay"("day");

-- CreateIndex
CREATE INDEX "AnalyticsLiveMinute_minute_idx" ON "AnalyticsLiveMinute"("minute");

-- CreateIndex
CREATE INDEX "AnalyticsAnonTally_minute_idx" ON "AnalyticsAnonTally"("minute");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsFact_dedupeKey_key" ON "AnalyticsFact"("dedupeKey");

-- CreateIndex
CREATE INDEX "AnalyticsFact_type_at_idx" ON "AnalyticsFact"("type", "at");

-- CreateIndex
CREATE INDEX "AnalyticsFact_actorUserId_idx" ON "AnalyticsFact"("actorUserId");

-- CreateIndex
CREATE INDEX "AnalyticsMpSession_createdAt_idx" ON "AnalyticsMpSession"("createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsMpSession_firstConnectedAt_idx" ON "AnalyticsMpSession"("firstConnectedAt");

-- CreateIndex
CREATE INDEX "AnalyticsMpSession_reachedMultiAt_idx" ON "AnalyticsMpSession"("reachedMultiAt");

-- CreateIndex
CREATE INDEX "AnalyticsMpSeat_firstConnectedAt_idx" ON "AnalyticsMpSeat"("firstConnectedAt");

-- CreateIndex
CREATE INDEX "AnalyticsMpDay_day_idx" ON "AnalyticsMpDay"("day");

-- CreateIndex
CREATE INDEX "AnalyticsProjectionWork_nextAttemptAt_idx" ON "AnalyticsProjectionWork"("nextAttemptAt");

-- CreateIndex
CREATE INDEX "AnalyticsProjectionWork_userId_idx" ON "AnalyticsProjectionWork"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsUserDaily_userId_day_idx" ON "AnalyticsUserDaily"("userId", "day");

-- AddForeignKey
ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "AnalyticsVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSessionDay" ADD CONSTRAINT "AnalyticsSessionDay_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsPageView" ADD CONSTRAINT "AnalyticsPageView_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsPlay" ADD CONSTRAINT "AnalyticsPlay_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnalyticsSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsPlayDay" ADD CONSTRAINT "AnalyticsPlayDay_playId_fkey" FOREIGN KEY ("playId") REFERENCES "AnalyticsPlay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsProjectionWork" ADD CONSTRAINT "AnalyticsProjectionWork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsUserDaily" ADD CONSTRAINT "AnalyticsUserDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
