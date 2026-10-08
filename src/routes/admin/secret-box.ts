import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

import { getEnv, getOptionalEnv } from '../../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function key(): Buffer {
  const secret = getOptionalEnv('TWO_FACTOR_ENCRYPTION_KEY') ?? getEnv('JWT_SECRET');
  return createHash('sha256').update(`two-factor:${secret}`).digest();
}

/** Seals a secret for storage: a database dump alone does not give anyone the codes. */
export function seal(plain: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function open(sealed: string): string {
  const data = Buffer.from(sealed, 'base64url');
  if (data.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Malformed sealed secret');
  }
  const decipher = createDecipheriv(ALGORITHM, key(), data.subarray(0, IV_LENGTH));
  decipher.setAuthTag(data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH));
  return Buffer.concat([
    decipher.update(data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)),
    decipher.final(),
  ]).toString('utf8');
}
