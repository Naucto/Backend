-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "aiCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "publishedAiCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AiConnection" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiContext" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "operations" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedBy" INTEGER,
    "revertsId" TEXT,
    "inverse" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiEditor" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "frozenId" TEXT,
    "snapshot" TEXT,

    CONSTRAINT "AiEditor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiBarrier" (
    "projectId" INTEGER NOT NULL,
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expected" TEXT[],
    "result" TEXT,
    "violation" TEXT,
    "lateUpdates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiBarrier_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "request" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "model" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDeclaration" (
    "id" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "categories" TEXT[],
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiConnection_tokenHash_key" ON "AiConnection"("tokenHash");

-- CreateIndex
CREATE INDEX "AiConnection_projectId_userId_idx" ON "AiConnection"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AiContext_projectId_userId_key" ON "AiContext"("projectId", "userId");

-- CreateIndex
CREATE INDEX "AiProposal_projectId_createdAt_idx" ON "AiProposal"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AiEditor_projectId_lastSeen_idx" ON "AiEditor"("projectId", "lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "AiBarrier_id_key" ON "AiBarrier"("id");

-- CreateIndex
CREATE INDEX "AiJob_projectId_createdAt_idx" ON "AiJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDeclaration_projectId_createdAt_idx" ON "AiDeclaration"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiConnection" ADD CONSTRAINT "AiConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiContext" ADD CONSTRAINT "AiContext_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiProposal" ADD CONSTRAINT "AiProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiEditor" ADD CONSTRAINT "AiEditor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBarrier" ADD CONSTRAINT "AiBarrier_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDeclaration" ADD CONSTRAINT "AiDeclaration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
