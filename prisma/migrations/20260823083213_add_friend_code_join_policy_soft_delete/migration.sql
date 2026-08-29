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
