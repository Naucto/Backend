/*
  Warnings:

  - You are about to drop the column `hiddenAt` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `hiddenReason` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `hidden_by_id` on the `Comment` table. All the data in the column will be lost.
  - You are about to drop the column `hiddenAt` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `hiddenReason` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `hidden_by_id` on the `Project` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Comment" DROP COLUMN "hiddenAt",
DROP COLUMN "hiddenReason",
DROP COLUMN "hidden_by_id";

-- AlterTable
ALTER TABLE "Project" DROP COLUMN "hiddenAt",
DROP COLUMN "hiddenReason",
DROP COLUMN "hidden_by_id";
