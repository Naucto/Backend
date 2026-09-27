-- CreateTable
CREATE TABLE "AiKey" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Assistant',
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiKeyGrant" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "projectId" INTEGER NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiKeyGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiKey_tokenHash_key" ON "AiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "AiKey_userId_createdAt_idx" ON "AiKey"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiKeyGrant_projectId_idx" ON "AiKeyGrant"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AiKeyGrant_keyId_projectId_key" ON "AiKeyGrant"("keyId", "projectId");

-- AddForeignKey
ALTER TABLE "AiKeyGrant" ADD CONSTRAINT "AiKeyGrant_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "AiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiKeyGrant" ADD CONSTRAINT "AiKeyGrant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
