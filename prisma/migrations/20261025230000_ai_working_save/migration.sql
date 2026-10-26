-- CreateTable
CREATE TABLE "AiWorkspace" (
    "projectId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "baseSnapshot" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "pendingReviewId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWorkspace_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "AiSaveReview" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "workspaceRevision" INTEGER NOT NULL,
    "resultSnapshot" TEXT NOT NULL,
    "nextBaseSnapshot" TEXT NOT NULL,
    "nextDraftSnapshot" TEXT NOT NULL,
    "categories" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSaveReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSaveReview_projectId_createdAt_idx" ON "AiSaveReview"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiWorkspace" ADD CONSTRAINT "AiWorkspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSaveReview" ADD CONSTRAINT "AiSaveReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
