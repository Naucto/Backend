-- AlterEnum
BEGIN;
CREATE TYPE "GameSessionVisibility_new" AS ENUM ('PUBLIC', 'FRIENDS_ONLY', 'INVITE_CODE');
ALTER TABLE "public"."GameSession" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "GameSession" ALTER COLUMN "visibility" TYPE "GameSessionVisibility_new" USING ("visibility"::text::"GameSessionVisibility_new");
ALTER TYPE "GameSessionVisibility" RENAME TO "GameSessionVisibility_old";
ALTER TYPE "GameSessionVisibility_new" RENAME TO "GameSessionVisibility";
DROP TYPE "public"."GameSessionVisibility_old";
ALTER TABLE "GameSession" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';
COMMIT;

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "joinCode" TEXT,
ADD COLUMN     "maxPlayers" INTEGER NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_joinCode_key" ON "GameSession"("joinCode");
