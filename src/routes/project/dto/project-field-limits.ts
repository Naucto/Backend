/**
 * Limits a project is held to.
 *
 * The text and tag limits cap abusive or accidental "infinite" input. They are enforced
 * server-side via `class-validator` on the create/update DTOs (the source of truth) and mirrored in
 * the Frontend inputs for UX.
 */
export const PROJECT_NAME_MAX_LENGTH = 25;
export const PROJECT_SHORT_DESC_MAX_LENGTH = 50;
export const PROJECT_LONG_DESC_MAX_LENGTH = 300;
/** Tags a project carries; a tag filter reads no more than this many either. */
export const PROJECT_MAX_TAGS = 12;

/** Named versions a project may hold when `S3_MAX_CHECKPOINTS` is unset. */
export const PROJECT_DEFAULT_MAX_CHECKPOINTS = 20;
/** Autosave slots kept per project when `S3_MAX_AUTO_HISTORY_VERSION` is unset. */
export const PROJECT_DEFAULT_MAX_AUTOSAVES = 4;
