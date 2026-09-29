-- Applying part of a proposal.
--
-- A `code` operation replaces a whole file, so accepting one is all-or-nothing: a person who wants
-- two of the assistant's four edits has to ask for all four, and whose four interact. Accepting a
-- range instead needs somewhere to record that the application was a part of a larger change, which
-- is what `parentId` is — the proposal the applied rows were derived from.
--
-- The original is deliberately not claimed by a partial application. It stays PENDING, so the
-- remainder can still be applied once the first part has been read against the document it actually
-- landed in. Each applied part is its own row, which keeps "one change is one undo unit" true: the
-- derived rows are what a revert stages, and reverting one does not disturb the rest.
ALTER TABLE "AiProposal" ADD COLUMN "parentId" TEXT;

CREATE INDEX "AiProposal_parentId_idx" ON "AiProposal"("parentId");
