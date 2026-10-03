import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';

import { withEnv } from '../../../test/env';
import { GithubAuthService } from './github-auth.service';

const FULL_CONFIG = {
  GITHUB_CLIENT_ID: 'client-id',
  GITHUB_CLIENT_SECRET: 'client-secret',
};

describe('GithubAuthService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('disables itself (no throw) when configuration is missing', async () => {
    withEnv({ GITHUB_CLIENT_ID: undefined, GITHUB_CLIENT_SECRET: undefined });
    const service = new GithubAuthService();

    expect(service.isAvailable).toBe(false);
    await expect(service.authenticate('code')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('is available when fully configured', () => {
    withEnv(FULL_CONFIG);
    expect(new GithubAuthService().isAvailable).toBe(true);
  });

  it('returns the user payload on a successful code exchange', async () => {
    withEnv(FULL_CONFIG);
    const service = new GithubAuthService();

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'at' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          login: 'ada',
          name: 'Ada',
          email: 'ada@example.com',
        }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.authenticate('code');

    expect(result).toEqual({ email: 'ada@example.com', name: 'Ada' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('answers 503, not 401, when the provider cannot be reached', async () => {
    withEnv(FULL_CONFIG);
    const service = new GithubAuthService();
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    await expect(service.authenticate('code')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('answers 502 when the provider replies with something that is not JSON', async () => {
    withEnv(FULL_CONFIG);
    const service = new GithubAuthService();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    }) as unknown as typeof fetch;

    await expect(service.authenticate('code')).rejects.toBeInstanceOf(BadGatewayException);
  });
});
