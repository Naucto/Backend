-- Extend ModerationActionType with new audit categories so every admin write
-- (edits, role/password/role-mgmt operations) can be logged distinctly.

ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'EDIT_USER';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'EDIT_PROJECT';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'EDIT_COMMENT';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'UPDATE_REPORT';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'RESET_PASSWORD';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'CREATE_ROLE';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'RENAME_ROLE';
ALTER TYPE "ModerationActionType" ADD VALUE IF NOT EXISTS 'DELETE_ROLE';
