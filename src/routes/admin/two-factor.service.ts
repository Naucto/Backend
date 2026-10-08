import { Injectable } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';

import { open, seal } from './secret-box';

const ISSUER = 'Naucto Admin';

export interface TwoFactorEnrolment {
  /** Base32, for typing into an authenticator by hand. */
  secret: string;
  /** The `otpauth://` URI an authenticator reads from a QR code. */
  otpauthUri: string;
}

/** Time-based one-time codes (RFC 6238): 6 digits, 30 second steps, SHA-1, as every authenticator expects. */
@Injectable()
export class TwoFactorService {
  enrol(accountLabel: string): TwoFactorEnrolment {
    const secret = new Secret({ size: 20 });
    const totp = new TOTP({ issuer: ISSUER, label: accountLabel, secret });
    return { secret: secret.base32, otpauthUri: totp.toString() };
  }

  /** One step of clock drift either way is accepted. */
  verify(base32: string, code: string): boolean {
    const token = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(token)) {
      return false;
    }
    const totp = new TOTP({ issuer: ISSUER, secret: Secret.fromBase32(base32) });
    return totp.validate({ token, window: 1 }) !== null;
  }

  sealSecret(base32: string): string {
    return seal(base32);
  }

  openSecret(sealed: string): string {
    return open(sealed);
  }
}
