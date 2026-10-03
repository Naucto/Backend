/** The characters a handle may hold; a handle appears in URLs and mentions, so it stays ASCII. */
const HANDLE_CHARACTERS = 'a-zA-Z0-9._-';

/**
 * The handle rule, read by every body that carries one and by the handle minted for an account a
 * provider signs up, so sign-up, a profile edit and a friend lookup cannot disagree.
 */
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;
export const HANDLE_PATTERN = new RegExp(`^[${HANDLE_CHARACTERS}]+$`);
export const HANDLE_PATTERN_MESSAGE =
  'A handle may hold letters, digits, dots, dashes and underscores';

/** A run of characters a handle may not hold, for turning free text into a handle. */
export const HANDLE_FORBIDDEN_RUN = new RegExp(`[^${HANDLE_CHARACTERS}]+`, 'g');
