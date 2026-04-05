-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "publishedLongDesc" TEXT,
ADD COLUMN     "publishedName" TEXT,
ADD COLUMN     "publishedShortDesc" TEXT,
ADD COLUMN     "publishedTags" TEXT[] DEFAULT ARRAY[]::TEXT[];
