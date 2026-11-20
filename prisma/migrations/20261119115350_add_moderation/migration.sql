-- CreateEnum
CREATE TYPE "ModerationTargetType" AS ENUM ('USER', 'PROJECT', 'COMMENT');

-- CreateEnum
CREATE TYPE "ModerationReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE', 'SEXUAL_CONTENT', 'VIOLENCE', 'ILLEGAL', 'IMPERSONATION', 'STOLEN_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('ACCOUNT_WARNED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REINSTATED', 'ACCOUNT_DELETED', 'PROFILE_CLEARED', 'ROLE_CHANGED', 'PROJECT_HIDDEN', 'PROJECT_RESTORED', 'PROJECT_DELETED', 'COMMENT_HIDDEN', 'COMMENT_RESTORED', 'COMMENT_DELETED', 'FLAGS_DISMISSED', 'DRAFT_VIEWED');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'MODERATION';

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Flag" (
    "id" SERIAL NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" INTEGER NOT NULL,
    "targetOwnerId" INTEGER,
    "reason" "ModerationReason" NOT NULL,
    "details" TEXT,
    "snapshot" JSONB NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "openKey" TEXT,
    "resolvedById" INTEGER,
    "resolvedAt" TIMESTAMP(3),
    "resolutionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" SERIAL NOT NULL,
    "action" "ModerationActionType" NOT NULL,
    "actorId" INTEGER NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" INTEGER NOT NULL,
    "subjectUserId" INTEGER,
    "reason" "ModerationReason",
    "publicMessage" TEXT,
    "internalNote" TEXT,
    "snapshot" JSONB,
    "expiresAt" TIMESTAMP(3),
    "visibleToSubject" BOOLEAN NOT NULL DEFAULT false,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Flag_openKey_key" ON "Flag"("openKey");

-- CreateIndex
CREATE INDEX "Flag_status_targetType_targetId_idx" ON "Flag"("status", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Flag_targetOwnerId_status_idx" ON "Flag"("targetOwnerId", "status");

-- CreateIndex
CREATE INDEX "Flag_reporterId_createdAt_idx" ON "Flag"("reporterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationAction_dedupeKey_key" ON "ModerationAction"("dedupeKey");

-- CreateIndex
CREATE INDEX "ModerationAction_subjectUserId_visibleToSubject_createdAt_idx" ON "ModerationAction"("subjectUserId", "visibleToSubject", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_targetType_targetId_createdAt_idx" ON "ModerationAction"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_actorId_createdAt_idx" ON "ModerationAction"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_action_createdAt_idx" ON "ModerationAction"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "ModerationAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
