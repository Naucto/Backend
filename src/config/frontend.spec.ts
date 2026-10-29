import { withEnv } from '../../test/env';
import { frontendLink, frontendUrl } from './frontend';

describe('frontend', () => {
  it('should fall back to the local dev server without FRONTEND_URL', () => {
    withEnv({ FRONTEND_URL: undefined });

    expect(frontendUrl()).toBe('http://localhost:3001');
    expect(frontendLink('/hub')).toBe('http://localhost:3001/hub');
  });

  it('should build a link on FRONTEND_URL, encoding its query', () => {
    withEnv({ FRONTEND_URL: 'https://naucto.net' });

    expect(frontendLink('/reset-password', { token: 'a+b/c' })).toBe(
      'https://naucto.net/reset-password?token=a%2Bb%2Fc',
    );
  });
});
