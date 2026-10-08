import { ServiceUnavailableException } from '@nestjs/common';

import { withEnv } from '../../../test/env';
import { GoogleAuthService } from './google-auth.service';

const FULL_CONFIG = {
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_REDIRECT_URI: 'https://app.example/callback',
};

const NO_CONFIG = {
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  GOOGLE_REDIRECT_URI: undefined,
};

describe('GoogleAuthService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('disables itself (no throw) when configuration is missing', async () => {
    withEnv(NO_CONFIG);
    const service = new GoogleAuthService();

    expect(service.isAvailable).toBe(false);
    await expect(
      service.authenticate({ code: 'code', codeVerifier: 'verifier' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is available when fully configured', () => {
    withEnv(FULL_CONFIG);
    expect(new GoogleAuthService().isAvailable).toBe(true);
  });

  it('returns the user payload on a successful code exchange', async () => {
    withEnv(FULL_CONFIG);
    const service = new GoogleAuthService();

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'ada@example.com',
          email_verified: true,
          sub: '1',
          name: 'Ada',
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.authenticate({ code: 'code', codeVerifier: 'verifier' });

    expect(result).toEqual({ email: 'ada@example.com', name: 'Ada' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blames the provider, not the token, when the profile cannot be fetched', async () => {
    withEnv(FULL_CONFIG);
    const service = new GoogleAuthService();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'at' }) })
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const refusal = service.authenticate({ code: 'code', codeVerifier: 'verifier' });

    await expect(refusal).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(refusal).rejects.toThrow('Google authentication service unavailable');
  });
});
