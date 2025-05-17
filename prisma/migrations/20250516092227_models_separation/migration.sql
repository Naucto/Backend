/*
  Warnings:

  - You are about to drop the `Comment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FriendRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Friendship` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GameSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Project` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Role` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Subscription` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WorkSession` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_ProjectCollaborators` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_UserRoles` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_WorkSessionUsers` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_parentId_fkey";

-- DropForeignKey
ALTER TABLE "Comment" DROP CONSTRAINT "Comment_projectId_fkey";

-- DropForeignKey
ALTER TABLE "FriendRequest" DROP CONSTRAINT "FriendRequest_fromId_fkey";

-- DropForeignKey
ALTER TABLE "FriendRequest" DROP CONSTRAINT "FriendRequest_toId_fkey";

-- DropForeignKey
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_userAId_fkey";

-- DropForeignKey
ALTER TABLE "Friendship" DROP CONSTRAINT "Friendship_userBId_fkey";

-- DropForeignKey
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_projectId_fkey";

-- DropForeignKey
ALTER TABLE "GameSession" DROP CONSTRAINT "GameSession_userId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_userId_fkey";

-- DropForeignKey
ALTER TABLE "WorkSession" DROP CONSTRAINT "WorkSession_projectId_fkey";

-- DropForeignKey
ALTER TABLE "_ProjectCollaborators" DROP CONSTRAINT "_ProjectCollaborators_A_fkey";

-- DropForeignKey
ALTER TABLE "_ProjectCollaborators" DROP CONSTRAINT "_ProjectCollaborators_B_fkey";

-- DropForeignKey
ALTER TABLE "_UserRoles" DROP CONSTRAINT "_UserRoles_A_fkey";

-- DropForeignKey
ALTER TABLE "_UserRoles" DROP CONSTRAINT "_UserRoles_B_fkey";

-- DropForeignKey
ALTER TABLE "_WorkSessionUsers" DROP CONSTRAINT "_WorkSessionUsers_A_fkey";

-- DropForeignKey
ALTER TABLE "_WorkSessionUsers" DROP CONSTRAINT "_WorkSessionUsers_B_fkey";

-- DropTable
DROP TABLE "Comment";

-- DropTable
DROP TABLE "FriendRequest";

-- DropTable
DROP TABLE "Friendship";

-- DropTable
DROP TABLE "GameSession";

-- DropTable
DROP TABLE "Project";

-- DropTable
DROP TABLE "Role";

-- DropTable
DROP TABLE "Subscription";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "WorkSession";

-- DropTable
DROP TABLE "_ProjectCollaborators";

-- DropTable
DROP TABLE "_UserRoles";

-- DropTable
DROP TABLE "_WorkSessionUsers";

-- DropEnum
DROP TYPE "MonetizationType";

-- DropEnum
DROP TYPE "ProjectStatus";
