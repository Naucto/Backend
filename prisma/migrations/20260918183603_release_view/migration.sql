-- CreateTable
CREATE TABLE "ReleaseView" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReleaseView_projectId_viewerKey_idx" ON "ReleaseView"("projectId", "viewerKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseView_projectId_viewerKey_day_key" ON "ReleaseView"("projectId", "viewerKey", "day");

-- AddForeignKey
ALTER TABLE "ReleaseView" ADD CONSTRAINT "ReleaseView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
