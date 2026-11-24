-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "firstPublishedAt" TIMESTAMP(3);

-- A game's first publication is its earliest RELEASE_PUBLISHED fact; games released before those
-- facts were recorded fall back to the date of their current release.
UPDATE "Project" AS project
SET "firstPublishedAt" = COALESCE(
  (
    SELECT MIN(fact."at")
    FROM "AnalyticsFact" AS fact
    WHERE fact."type" = 'RELEASE_PUBLISHED' AND fact."projectId" = project."id"
  ),
  project."publishedAt"
);
