/*
  Warnings:

  - You are about to drop the column `fileName` on the `Project` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Project" DROP COLUMN "fileName",
ALTER COLUMN "longDesc" DROP NOT NULL,
ALTER COLUMN "status" DROP NOT NULL,
ALTER COLUMN "monetization" DROP NOT NULL;
