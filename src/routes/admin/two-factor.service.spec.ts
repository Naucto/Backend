import { Secret, TOTP } from 'otpauth';

import { withEnv } from '../../../test/env';
import { AttemptLimiter } from './attempt-limiter';
import { TwoFactorService } from './two-factor.service';

const codeFor = (base32: string, at = Date.now()): string =>
  new TOTP({ secret: Secret.fromBase32(base32) }).generate({ timestamp: at });

describe('TwoFactorService', () => {
  const service = new TwoFactorService();

  it('enrols with a secret and a URI an authenticator can read', () => {
    const { secret, otpauthUri } = service.enrol('ada@example.com');

    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/Naucto%20Admin:ada%40example\.com\?/);
    expect(otpauthUri).toContain(`secret=${secret}`);
  });

  it('accepts the current code, with or without a space, and one step of drift', () => {
    const { secret } = service.enrol('ada@example.com');
    const code = codeFor(secret);

    expect(service.verify(secret, code)).toBe(true);
    expect(service.verify(secret, `${code.slice(0, 3)} ${code.slice(3)}`)).toBe(true);
    expect(service.verify(secret, codeFor(secret, Date.now() - 30_000))).toBe(true);
  });

  it('refuses a stale code, another secret and anything that is not 6 digits', () => {
    const { secret } = service.enrol('ada@example.com');
    const other = service.enrol('bob@example.com').secret;

    expect(service.verify(secret, codeFor(secret, Date.now() - 5 * 60_000))).toBe(false);
    expect(service.verify(secret, codeFor(other))).toBe(false);
    expect(service.verify(secret, 'abcdef')).toBe(false);
    expect(service.verify(secret, '12345')).toBe(false);
  });

  it('seals a secret so the stored form never shows it, and opens it back', () => {
    withEnv({ JWT_SECRET: 'two-factor-spec-secret', TWO_FACTOR_ENCRYPTION_KEY: undefined });
    const sealed = service.sealSecret('JBSWY3DPEHPK3PXP');

    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(service.sealSecret('JBSWY3DPEHPK3PXP')).not.toBe(sealed);
    expect(service.openSecret(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });
});

describe('AttemptLimiter', () => {
  it('locks a key after its failures, until the window that started with the first one ends', () => {
    let now = 0;
    const limiter = new AttemptLimiter(2, 60_000, () => now);

    limiter.fail('key');
    limiter.assertAllowed('key');
    now = 30_000;
    limiter.fail('key');
    expect(() => {
      limiter.assertAllowed('key');
    }).toThrow('Try again in 1 minute');

    now = 60_000;
    limiter.assertAllowed('key');
  });

  it('keeps keys apart, and forgets one that is cleared', () => {
    const limiter = new AttemptLimiter(1, 60_000);

    limiter.fail('a-key');
    limiter.assertAllowed('another-key');
    limiter.clear('a-key');
    limiter.assertAllowed('a-key');
  });
});
