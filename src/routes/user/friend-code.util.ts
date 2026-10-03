import { randomBytes } from "crypto";

// Crockford base32: no I, L, O, U so codes survive being read aloud / typed.
export const FRIEND_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const FRIEND_CODE_LENGTH = 8;

export function generateFriendCode(): string {
  // The alphabet's length divides the number of values a byte takes, so the modulo is unbiased.
  return Array.from(randomBytes(FRIEND_CODE_LENGTH), (byte) =>
    FRIEND_CODE_ALPHABET.charAt(byte % FRIEND_CODE_ALPHABET.length)
  ).join("");
}

// Canonical form of user input: uppercase, separators dropped, and the
// Crockford decode aliases folded (I/L -> 1, O -> 0). Returns null when the
// result is not a well-formed code.
export function normalizeFriendCode(raw: string): string | null {
  const folded = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");

  if (folded.length !== FRIEND_CODE_LENGTH) {
    return null;
  }
  for (const char of folded) {
    if (!FRIEND_CODE_ALPHABET.includes(char)) {
      return null;
    }
  }

  return folded;
}
