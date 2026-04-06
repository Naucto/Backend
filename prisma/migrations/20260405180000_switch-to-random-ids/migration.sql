-- Migration: Switch to random IDs
-- Description: Removed autoincrement defaults from all primary key columns.
--              Application code now generates random IDs before creating records.

-- Drop default values (sequences) from ID columns in user.prisma models
ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Role" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "RefreshToken" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "FriendRequest" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Friendship" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "id" DROP DEFAULT;

-- Drop default values (sequences) from ID columns in project.prisma models
ALTER TABLE "Project" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Comment" ALTER COLUMN "id" DROP DEFAULT;

-- Drop default values (sequences) from ID columns in session.prisma models
ALTER TABLE "GameSession" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "WorkSession" ALTER COLUMN "id" DROP DEFAULT;

-- Optionally drop the now-unused sequences
DROP SEQUENCE IF EXISTS "User_id_seq";
DROP SEQUENCE IF EXISTS "Role_id_seq";
DROP SEQUENCE IF EXISTS "RefreshToken_id_seq";
DROP SEQUENCE IF EXISTS "FriendRequest_id_seq";
DROP SEQUENCE IF EXISTS "Friendship_id_seq";
DROP SEQUENCE IF EXISTS "Subscription_id_seq";
DROP SEQUENCE IF EXISTS "Project_id_seq";
DROP SEQUENCE IF EXISTS "Comment_id_seq";
DROP SEQUENCE IF EXISTS "GameSession_id_seq";
DROP SEQUENCE IF EXISTS "WorkSession_id_seq";
