-- CreateEnum
CREATE TYPE "FeedbackContext" AS ENUM ('PLAYER', 'CREATOR');

-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('PROMPT', 'MANUAL');

-- CreateEnum
CREATE TYPE "RatingReason" AS ENUM ('BUGS', 'PERFORMANCE', 'HARD_TO_USE', 'MISSING_FEATURE', 'CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BugCategory" AS ENUM ('GAMEPLAY', 'EDITOR', 'GRAPHICS', 'SOUND', 'NETPLAY', 'ACCOUNT', 'PERFORMANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "BugStatus" AS ENUM ('NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "FeedbackPromptStatus" AS ENUM ('ANSWERED', 'DECLINED', 'SNOOZED');

-- CreateEnum
CREATE TYPE "CrashSource" AS ENUM ('WEB', 'ENGINE', 'BACKEND');

-- CreateEnum
CREATE TYPE "CrashStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "PlatformRating" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" "RatingReason"[] DEFAULT ARRAY[]::"RatingReason"[],
    "liked" TEXT,
    "improve" TEXT,
    "context" "FeedbackContext" NOT NULL,
    "source" "FeedbackSource" NOT NULL,
    "releaseId" INTEGER,
    "appRelease" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BugReport" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "category" "BugCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "releaseId" INTEGER,
    "projectId" INTEGER,
    "ratingId" INTEGER,
    "context" JSONB NOT NULL,
    "screenshotKey" TEXT,
    "screenshotMime" TEXT,
    "screenshotBytes" INTEGER,
    "status" "BugStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackPrompt" (
    "userId" INTEGER NOT NULL,
    "status" "FeedbackPromptStatus" NOT NULL,
    "snoozedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackPrompt_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "CrashGroup" (
    "id" SERIAL NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" "CrashSource" NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "lastStack" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRelease" TEXT,
    "status" "CrashStatus" NOT NULL DEFAULT 'OPEN',
    "regressedAt" TIMESTAMP(3),

    CONSTRAINT "CrashGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrashEvent" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT NOT NULL,
    "stack" TEXT NOT NULL,
    "appRelease" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "extra" JSONB,

    CONSTRAINT "CrashEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformRating_createdAt_idx" ON "PlatformRating"("createdAt");

-- CreateIndex
CREATE INDEX "PlatformRating_userId_idx" ON "PlatformRating"("userId");

-- CreateIndex
CREATE INDEX "BugReport_status_createdAt_idx" ON "BugReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BugReport_userId_idx" ON "BugReport"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CrashGroup_fingerprint_key" ON "CrashGroup"("fingerprint");

-- CreateIndex
CREATE INDEX "CrashGroup_lastSeen_idx" ON "CrashGroup"("lastSeen");

-- CreateIndex
CREATE INDEX "CrashGroup_status_lastSeen_idx" ON "CrashGroup"("status", "lastSeen");

-- CreateIndex
CREATE INDEX "CrashEvent_groupId_createdAt_idx" ON "CrashEvent"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlatformRating" ADD CONSTRAINT "PlatformRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_ratingId_fkey" FOREIGN KEY ("ratingId") REFERENCES "PlatformRating"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackPrompt" ADD CONSTRAINT "FeedbackPrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrashEvent" ADD CONSTRAINT "CrashEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CrashGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
