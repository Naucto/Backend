-- CreateIndex
CREATE INDEX "GameSession_userId_idx" ON "GameSession"("userId");

-- CreateIndex
CREATE INDEX "GameSession_projectId_idx" ON "GameSession"("projectId");

-- CreateIndex
CREATE INDEX "WorkSession_projectId_idx" ON "WorkSession"("projectId");

-- CreateIndex
CREATE INDEX "WorkSession_hostId_idx" ON "WorkSession"("hostId");
