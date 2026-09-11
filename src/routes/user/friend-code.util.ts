import { randomBytes } from "crypto";

// Crockford base32: no I, L, O, U so codes survive being read aloud / typed.
export const FRIEND_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const FRIEND_CODE_LENGTH = 8;

export function generateFriendCode(): string {
  const alphabetLength = FRIEND_CODE_ALPHABET.length;
  const maxUnbiasedByte = Math.floor(256 / alphabetLength) * alphabetLength;

  let code = "";
  while (code.length < FRIEND_CODE_LENGTH) {
    const bytes = randomBytes(FRIEND_CODE_LENGTH - code.length);
    for (const byte of bytes) {
      if (byte >= maxUnbiasedByte) {
        continue;
      }

      code += FRIEND_CODE_ALPHABET[byte % alphabetLength];
      if (code.length === FRIEND_CODE_LENGTH) {
        break;
      }
    }
  }

  return code;
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
