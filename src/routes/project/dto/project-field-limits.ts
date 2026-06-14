/**
 * Shared length limits for user-supplied project text fields.
 *
 * These cap abusive / accidental "infinite" titles and descriptions. They are
 * enforced server-side via `class-validator` on the create/update DTOs (the
 * source of truth) and mirrored in the Frontend inputs for UX.
 */
export const PROJECT_NAME_MAX_LENGTH = 25;
export const PROJECT_SHORT_DESC_MAX_LENGTH = 50;
export const PROJECT_LONG_DESC_MAX_LENGTH = 300;

