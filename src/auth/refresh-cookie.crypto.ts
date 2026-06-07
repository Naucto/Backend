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
  return createHash("sha256").update(secret).digest();
}

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
