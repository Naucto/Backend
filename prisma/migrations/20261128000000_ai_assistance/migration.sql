-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "aiCategories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AiKey" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Assistant',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiWorkspace" (
    "projectId" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "base" BYTEA NOT NULL,
    "draft" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWorkspace_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "AiJob" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
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
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "categories" TEXT[],
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiKey_tokenHash_key" ON "AiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "AiKey_userId_createdAt_idx" ON "AiKey"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiJob_projectId_createdAt_idx" ON "AiJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDeclaration_projectId_createdAt_idx" ON "AiDeclaration"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiKey" ADD CONSTRAINT "AiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiWorkspace" ADD CONSTRAINT "AiWorkspace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDeclaration" ADD CONSTRAINT "AiDeclaration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

