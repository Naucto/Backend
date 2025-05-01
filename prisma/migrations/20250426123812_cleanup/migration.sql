/*
  Warnings:

  - You are about to drop the column `status` on the `FriendRequest` table. All the data in the column will be lost.
  - The `status` column on the `Project` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `type` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the `GameStat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GlobalStats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectStat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserStat` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_LikedGames` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_MostPlayedGames` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_RecentlyPlayedGames` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[fromId,toId]` on the table `FriendRequest` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userAId,userBId]` on the table `Friendship` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `price` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

-- DropForeignKey
ALTER TABLE "GameStat" DROP CONSTRAINT "GameStat_projectId_fkey";

-- DropForeignKey
ALTER TABLE "GameStat" DROP CONSTRAINT "GameStat_userId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectStat" DROP CONSTRAINT "ProjectStat_projectId_fkey";

-- DropForeignKey
ALTER TABLE "UserStat" DROP CONSTRAINT "UserStat_userId_fkey";

-- DropForeignKey
ALTER TABLE "_LikedGames" DROP CONSTRAINT "_LikedGames_A_fkey";

-- DropForeignKey
ALTER TABLE "_LikedGames" DROP CONSTRAINT "_LikedGames_B_fkey";

-- DropForeignKey
ALTER TABLE "_MostPlayedGames" DROP CONSTRAINT "_MostPlayedGames_A_fkey";

-- DropForeignKey
ALTER TABLE "_MostPlayedGames" DROP CONSTRAINT "_MostPlayedGames_B_fkey";

-- DropForeignKey
ALTER TABLE "_RecentlyPlayedGames" DROP CONSTRAINT "_RecentlyPlayedGames_A_fkey";

-- DropForeignKey
ALTER TABLE "_RecentlyPlayedGames" DROP CONSTRAINT "_RecentlyPlayedGames_B_fkey";

-- AlterTable
ALTER TABLE "FriendRequest" DROP COLUMN "status";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "activePlayers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "likes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uniquePlayers" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "status",
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'IN_PROGRESS',
ALTER COLUMN "monetization" SET DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "type",
ADD COLUMN     "price" INTEGER NOT NULL;

-- DropTable
DROP TABLE "GameStat";

-- DropTable
DROP TABLE "GlobalStats";

-- DropTable
DROP TABLE "ProjectStat";

-- DropTable
DROP TABLE "UserStat";

-- DropTable
DROP TABLE "_LikedGames";

-- DropTable
DROP TABLE "_MostPlayedGames";

-- DropTable
DROP TABLE "_RecentlyPlayedGames";

-- CreateTable
CREATE TABLE "GameSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comment_projectId_idx" ON "Comment"("projectId");

-- CreateIndex
CREATE INDEX "Comment_authorId_idx" ON "Comment"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "FriendRequest_fromId_toId_key" ON "FriendRequest"("fromId", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
