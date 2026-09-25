/*
  Warnings:

  - You are about to drop the column `moderatedAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `moderated_by_id` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `moderationReason` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "moderatedAt",
DROP COLUMN "moderated_by_id",
DROP COLUMN "moderationReason";
