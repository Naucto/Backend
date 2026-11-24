-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationActionType" ADD VALUE 'COLLECTION_HIDDEN';
ALTER TYPE "ModerationActionType" ADD VALUE 'COLLECTION_RESTORED';
ALTER TYPE "ModerationActionType" ADD VALUE 'COLLECTION_DELETED';

-- AlterEnum
ALTER TYPE "ModerationTargetType" ADD VALUE 'COLLECTION';

-- AlterTable
ALTER TABLE "Collection" ADD COLUMN     "hiddenAt" TIMESTAMP(3);
