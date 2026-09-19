
-- CreateTable
CREATE TABLE "FeaturedRelease" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "featuredById" INTEGER,
    "note" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeaturedRelease_projectId_idx" ON "FeaturedRelease"("projectId");

-- CreateIndex
CREATE INDEX "FeaturedRelease_endsAt_startsAt_idx" ON "FeaturedRelease"("endsAt", "startsAt");

-- AddForeignKey
ALTER TABLE "FeaturedRelease" ADD CONSTRAINT "FeaturedRelease_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedRelease" ADD CONSTRAINT "FeaturedRelease_featuredById_fkey" FOREIGN KEY ("featuredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed the role required by the admin curation endpoints (see AdminOnly()).
INSERT INTO "Role" ("name") VALUES ('Admin') ON CONFLICT ("name") DO NOTHING;
