/*
  Warnings:

  - You are about to drop the column `userId` on the `GameSession` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[sessionId]` on the table `GameSession` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `hostId` to the `GameSession` table without a default value. This is not possible if the table is not empty.
  - The required column `sessionId` was added to the `GameSession` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- CreateEnum
CREATE TYPE "GameSessionVisibility" AS ENUM ('PUBLIC', 'FRIENDS_ONLY', 'PRIVATE');

-- DropForeignKey
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_userId_fkey";

-- DropIndex
DROP INDEX "GameSession_userId_idx";

-- AlterTable
ALTER TABLE "GameSession" DROP COLUMN "userId",
ADD COLUMN     "hostId" INTEGER NOT NULL,
ADD COLUMN     "sessionId" TEXT NOT NULL,
ADD COLUMN     "visibility" "GameSessionVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "_UserJoinedGameSessions" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_UserJoinedGameSessions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_UserJoinedGameSessions_B_index" ON "_UserJoinedGameSessions"("B");

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_sessionId_key" ON "GameSession"("sessionId");

-- CreateIndex
CREATE INDEX "GameSession_hostId_idx" ON "GameSession"("hostId");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserJoinedGameSessions" ADD CONSTRAINT "_UserJoinedGameSessions_A_fkey" FOREIGN KEY ("A") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserJoinedGameSessions" ADD CONSTRAINT "_UserJoinedGameSessions_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
