-- AlterTable
ALTER TABLE "User" ADD COLUMN     "description" TEXT,
ALTER COLUMN "password" DROP NOT NULL;
