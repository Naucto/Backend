-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "forked_from_id" INTEGER;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_forked_from_id_fkey" FOREIGN KEY ("forked_from_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
