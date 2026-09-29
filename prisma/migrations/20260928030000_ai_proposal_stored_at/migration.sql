-- Applied-but-not-stored, made knowable.
--
-- `storedAt` is set by the first save whose bytes carry this proposal's `ai.applied` receipt, so a
-- null next to a status of APPLIED means the change is committed to in a document that has not been
-- persisted anywhere. `appliedAt` is what a re-apply is compare-and-swapped against, so two tabs
-- cannot both re-apply the same claim.
--
-- Existing rows get their appliedAt from the claim they already have: an APPLIED proposal was, by
-- definition, claimed at some point, and updatedAt moves for other reasons so it would not do.
ALTER TABLE "AiProposal" ADD COLUMN "appliedAt" TIMESTAMP(3);
ALTER TABLE "AiProposal" ADD COLUMN "storedAt" TIMESTAMP(3);

UPDATE "AiProposal" SET "appliedAt" = "createdAt" WHERE "status" = 'APPLIED';

-- No backfill for storedAt. It is not knowable from the row: a proposal applied before this
-- migration has very probably been stored many times over, and a blank here would report every one
-- of them as unsaved — which would offer to re-apply changes that are already in the project, and a
-- whole-file code change applied twice concatenates the file. Null is therefore read as "unknown",
-- and only a claim made from now on is eligible to be applied again.
CREATE INDEX "AiProposal_status_storedAt_idx" ON "AiProposal"("status", "storedAt");
