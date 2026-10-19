/*
  Warnings:

  - The primary key for the `FeedbackPrompt` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Added the required column `context` to the `FeedbackPrompt` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FeedbackPrompt" DROP CONSTRAINT "FeedbackPrompt_pkey",
ADD COLUMN     "context" "FeedbackContext" NOT NULL,
ADD CONSTRAINT "FeedbackPrompt_pkey" PRIMARY KEY ("userId", "context");
