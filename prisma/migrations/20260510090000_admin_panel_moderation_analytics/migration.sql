-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('USER', 'PROJECT', 'COMMENT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationTargetType" AS ENUM ('USER', 'PROJECT', 'COMMENT', 'REPORT');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('SUSPEND_USER', 'BAN_USER', 'RESTORE_USER', 'HIDE_PROJECT', 'RESTORE_PROJECT', 'UNPUBLISH_PROJECT', 'HIDE_COMMENT', 'RESTORE_COMMENT', 'REVIEW_REPORT', 'RESOLVE_REPORT', 'DISMISS_REPORT', 'ANONYMIZE_USER', 'HARD_DELETE_USER', 'CREATE_STAFF_USER', 'UPDATE_ROLES');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('ACCOUNT_CREATED', 'LOGIN', 'PROJECT_CREATED', 'PROJECT_PUBLISHED', 'PROJECT_UNPUBLISHED', 'COMMENT_CREATED', 'COMMENT_REPLIED', 'LIKE_CREATED', 'LIKE_REMOVED', 'GAME_VIEWED', 'GAME_SESSION_STARTED', 'GAME_SESSION_ENDED', 'WORK_SESSION_STARTED', 'WORK_SESSION_JOINED', 'WORK_SESSION_LEFT');

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "moderationReason" TEXT,
  ADD COLUMN "moderatedAt" TIMESTAMP(3),
  ADD COLUMN "moderated_by_id" INTEGER;

-- AlterTable
ALTER TABLE "Project"
  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hiddenReason" TEXT,
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "hidden_by_id" INTEGER;

-- AlterTable
ALTER TABLE "Comment"
  ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hiddenReason" TEXT,
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "hidden_by_id" INTEGER;

-- CreateTable
CREATE TABLE "Report" (
  "id" SERIAL NOT NULL,
  "targetType" "ReportTargetType" NOT NULL,
  "targetId" INTEGER NOT NULL,
  "reporterId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolutionNote" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolved_by_id" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
  "id" SERIAL NOT NULL,
  "actorId" INTEGER,
  "targetType" "ModerationTargetType" NOT NULL,
  "targetId" INTEGER NOT NULL,
  "action" "ModerationActionType" NOT NULL,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "reportId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
  "id" SERIAL NOT NULL,
  "type" "AnalyticsEventType" NOT NULL,
  "userId" INTEGER,
  "projectId" INTEGER,
  "commentId" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAnalyticsRollup" (
  "id" SERIAL NOT NULL,
  "date" DATE NOT NULL,
  "accountsCreated" INTEGER NOT NULL DEFAULT 0,
  "logins" INTEGER NOT NULL DEFAULT 0,
  "projectsCreated" INTEGER NOT NULL DEFAULT 0,
  "projectsPublished" INTEGER NOT NULL DEFAULT 0,
  "projectsUnpublished" INTEGER NOT NULL DEFAULT 0,
  "commentsCreated" INTEGER NOT NULL DEFAULT 0,
  "likesCreated" INTEGER NOT NULL DEFAULT 0,
  "likesRemoved" INTEGER NOT NULL DEFAULT 0,
  "gameViews" INTEGER NOT NULL DEFAULT 0,
  "gameSessionsStarted" INTEGER NOT NULL DEFAULT 0,
  "gameSessionsEnded" INTEGER NOT NULL DEFAULT 0,
  "workSessionsStarted" INTEGER NOT NULL DEFAULT 0,
  "workSessionsJoined" INTEGER NOT NULL DEFAULT 0,
  "workSessionsLeft" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DailyAnalyticsRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_targetType_targetId_idx" ON "Report"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "Report"("reporterId");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_createdAt_idx" ON "Report"("createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_actorId_idx" ON "ModerationAction"("actorId");

-- CreateIndex
CREATE INDEX "ModerationAction_targetType_targetId_idx" ON "ModerationAction"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ModerationAction_action_idx" ON "ModerationAction"("action");

-- CreateIndex
CREATE INDEX "ModerationAction_createdAt_idx" ON "ModerationAction"("createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_idx" ON "AnalyticsEvent"("type");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_idx" ON "AnalyticsEvent"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_projectId_idx" ON "AnalyticsEvent"("projectId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_commentId_idx" ON "AnalyticsEvent"("commentId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAnalyticsRollup_date_key" ON "DailyAnalyticsRollup"("date");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed canonical staff roles
INSERT INTO "Role" ("name")
VALUES ('Admin'), ('Moderator')
ON CONFLICT ("name") DO NOTHING;
