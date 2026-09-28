/*
  Warnings:

  - You are about to drop the `AiBarrier` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AiEditor` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AiBarrier" DROP CONSTRAINT "AiBarrier_projectId_fkey";

-- DropForeignKey
ALTER TABLE "AiEditor" DROP CONSTRAINT "AiEditor_projectId_fkey";

-- DropTable
DROP TABLE "AiBarrier";

-- DropTable
DROP TABLE "AiEditor";
