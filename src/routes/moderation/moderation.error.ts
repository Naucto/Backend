import { NotImplementedException } from '@nestjs/common';

/** The refusals a client of moderation tells apart, each answered as the `code` of the error body. */
export const MODERATION_ERROR = {
  CANNOT_FLAG_OWN_CONTENT: 'CANNOT_FLAG_OWN_CONTENT',
  FLAG_TARGET_NOT_FOUND: 'FLAG_TARGET_NOT_FOUND',
  ALREADY_FLAGGED: 'ALREADY_FLAGGED',
  NO_OPEN_FLAGS: 'NO_OPEN_FLAGS',
  OWN_CASE: 'OWN_CASE',
  CANNOT_MODERATE_SELF: 'CANNOT_MODERATE_SELF',
  TARGET_OUTRANKS_ACTOR: 'TARGET_OUTRANKS_ACTOR',
  NOT_SUSPENDED: 'NOT_SUSPENDED',
  ALREADY_HIDDEN: 'ALREADY_HIDDEN',
  NOT_HIDDEN: 'NOT_HIDDEN',
  COMMENT_DELETED: 'COMMENT_DELETED',
} as const;

export type ModerationErrorCode = keyof typeof MODERATION_ERROR;

// TODO(NCTO-211): gone once every moderation service is implemented.
export function notAvailableYet(): never {
  throw new NotImplementedException('Moderation is not available yet');
}
