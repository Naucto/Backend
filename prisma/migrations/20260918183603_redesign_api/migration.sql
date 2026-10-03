-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "content_size" JSONB,
ADD COLUMN     "content_size_total" INTEGER;

/*
  Warnings:

  - A unique constraint covering the columns `[friendCode]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SessionJoinPolicy" AS ENUM ('ANYONE', 'FRIENDS', 'CODE_ONLY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "friendCode" TEXT,
ADD COLUMN     "sessionJoinPolicy" "SessionJoinPolicy" NOT NULL DEFAULT 'ANYONE';

-- CreateIndex
CREATE UNIQUE INDEX "User_friendCode_key" ON "User"("friendCode");

-- DropForeignKey
ALTER TABLE "FriendRequest" DROP CONSTRAINT "FriendRequest_fromId_fkey";

-- DropForeignKey
ALTER TABLE "FriendRequest" DROP CONSTRAINT "FriendRequest_toId_fkey";

-- DropForeignKey
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_userAId_fkey";

-- DropForeignKey
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_userBId_fkey";

-- CreateIndex
CREATE INDEX "FriendRequest_toId_idx" ON "FriendRequest"("toId");

-- CreateIndex
CREATE INDEX "Friendship_userBId_idx" ON "Friendship"("userBId");

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_toId_fkey" FOREIGN KEY ("toId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('GENERIC', 'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'FEATURED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "data" JSONB,
ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'GENERIC';

-- CreateTable
CREATE TABLE "FeaturedRelease" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "featuredById" INTEGER,
    "note" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeaturedRelease_projectId_idx" ON "FeaturedRelease"("projectId");

-- CreateIndex
CREATE INDEX "FeaturedRelease_endsAt_startsAt_idx" ON "FeaturedRelease"("endsAt", "startsAt");

-- AddForeignKey
ALTER TABLE "FeaturedRelease" ADD CONSTRAINT "FeaturedRelease_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedRelease" ADD CONSTRAINT "FeaturedRelease_featuredById_fkey" FOREIGN KEY ("featuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the role required by the admin curation endpoints (see AdminOnly()).
INSERT INTO "Role" ("name") VALUES ('Admin') ON CONFLICT ("name") DO NOTHING;

-- CreateEnum
CREATE TYPE "PersonalColour" AS ENUM ('SKY', 'BLUSH', 'JADE', 'GOLD', 'ORANGE', 'HOT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "colour" "PersonalColour";

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'COLLABORATOR_ADDED';

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'COLLABORATOR_REMOVED';

-- CreateTable
CREATE TABLE "ReleaseView" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReleaseView_projectId_viewerKey_idx" ON "ReleaseView"("projectId", "viewerKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseView_projectId_viewerKey_day_key" ON "ReleaseView"("projectId", "viewerKey", "day");

-- AddForeignKey
ALTER TABLE "ReleaseView" ADD CONSTRAINT "ReleaseView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
