-- DropIndex
DROP INDEX "EmailToken_userId_purpose_idx";

-- CreateIndex
CREATE UNIQUE INDEX "EmailToken_userId_purpose_key" ON "EmailToken"("userId", "purpose");
