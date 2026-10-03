/** Bounds on what a host and a joiner may send; the DTOs enforce them and the specs read them. */
export const SESSION_TITLE_MIN_LENGTH = 1;
export const SESSION_TITLE_MAX_LENGTH = 80;

/** Seats in a session, its host's included. */
export const SESSION_MIN_PLAYERS = 2;
export const SESSION_MAX_PLAYERS = 16;

/** Length of the join code a session is given. */
export const JOIN_CODE_LENGTH = 8;

/**
 * Bounds the join code a client sends, not its shape: a code of another length is refused as a code
 * that matches no session.
 */
export const JOIN_CODE_INPUT_MAX_LENGTH = 16;
