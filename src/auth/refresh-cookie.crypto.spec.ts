import { withEnv } from '../../test/env';
import { MalformedRefreshCookieError } from './auth.error';
import { decryptRefreshToken, encryptRefreshToken } from './refresh-cookie.crypto';

describe('the refresh cookie', () => {
  beforeEach(() => {
    withEnv({ REFRESH_TOKEN_ENCRYPTION_KEY: 'a key for the test' });
  });

  it('reads back the token it was written from', () => {
    expect(decryptRefreshToken(encryptRefreshToken('refresh123'))).toBe('refresh123');
  });

  it('refuses a value too short to be one, under an error of its own', () => {
    expect(() => decryptRefreshToken('abc')).toThrow(MalformedRefreshCookieError);
  });
});
