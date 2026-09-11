-- CreateEnum
CREATE TYPE "PersonalColour" AS ENUM ('SKY', 'BLUSH', 'JADE', 'GOLD', 'ORANGE', 'HOT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "colour" "PersonalColour";
