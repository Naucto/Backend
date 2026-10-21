-- CreateEnum
CREATE TYPE "AnalyticsMarkerAudience" AS ENUM ('EVERYONE', 'PLAYERS', 'CREATORS');

-- CreateTable
CREATE TABLE "AnalyticsMarker" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "channel" VARCHAR(40),
    "url" VARCHAR(2048),
    "audience" "AnalyticsMarkerAudience" NOT NULL DEFAULT 'EVERYONE',
    "releaseId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsMarker_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnalyticsMarker_at_idx" ON "AnalyticsMarker"("at");
