/*
  Warnings:

  - You are about to drop the column `rating` on the `Comment` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_parentId_fkey";

-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_projectId_fkey";

-- AlterTable
ALTER TABLE "Comment" DROP COLUMN "rating";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Set default value for updatedAt to handle existing rows
UPDATE "Project" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;

-- Set NOT NULL constraint after populating existing rows
ALTER TABLE "Project" ALTER COLUMN "updatedAt" SET NOT NULL;

-- CreateTable
CREATE TABLE "Like" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Like_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Like_projectId_idx" ON "Like"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Like_userId_projectId_key" ON "Like"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Like" ADD CONSTRAINT "Like_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
