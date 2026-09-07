-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('GENERIC', 'FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'FEATURED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "data" JSONB,
ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'GENERIC';
