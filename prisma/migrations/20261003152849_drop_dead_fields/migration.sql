/*
  Warnings:

  - You are about to drop the column `activePlayers` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `content_extension` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `content_key` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `content_uploaded_at` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the `Subscription` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `status` on table `Project` required. This step will fail if there are existing NULL values in that column.
  - Made the column `monetization` on table `Project` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";

-- Backfill: SET NOT NULL fails on any row still holding NULL.
UPDATE "Project" SET "status" = 'IN_PROGRESS' WHERE "status" IS NULL;
UPDATE "Project" SET "monetization" = 'NONE' WHERE "monetization" IS NULL;

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "activePlayers",
DROP COLUMN "content_extension",
DROP COLUMN "content_key",
DROP COLUMN "content_uploaded_at",
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "monetization" SET NOT NULL;

-- DropTable
DROP TABLE "Subscription";
