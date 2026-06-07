import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret =
    process.env["REFRESH_TOKEN_ENCRYPTION_KEY"] ?? process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error(
      "Missing REFRESH_TOKEN_ENCRYPTION_KEY or JWT_SECRET for refresh cookie encryption"
    );
  }
  // Derive a fixed 32-byte key from the configured secret.
  return createHash("sha256").update(secret).digest();
}

/**
 * Encrypt a refresh token before it is stored in the client cookie.
 *
 * Uses AES-256-GCM so the value persisted on the end-user's machine is never
 * stored in clear text. Returns a base64url payload of `iv || authTag ||
 * ciphertext`.
 */
export function encryptRefreshToken(token: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

/**
 * Decrypt a refresh token previously produced by {@link encryptRefreshToken}.
 *
 * Throws if the payload is malformed or fails authentication (e.g. tampered
 * with, or issued before cookie encryption was enabled).
 */
export function decryptRefreshToken(payload: string): string {
  const data = Buffer.from(payload, "base64url");
  if (data.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Malformed refresh token cookie");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString("utf8");
}
