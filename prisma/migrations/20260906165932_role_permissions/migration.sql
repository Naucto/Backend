-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
