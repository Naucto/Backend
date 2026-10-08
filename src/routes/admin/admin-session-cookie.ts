import { CookieOptions } from 'express';

import { getOptionalEnv } from '../../config/env';
import { ADMIN_SESSION_LIFETIME_S } from './admin-session.service';

export const ADMIN_SESSION_COOKIE = 'naucto_admin_session';

/**
 * The admin panel reaches the API through its own server's `/api` proxy, so the cookie is
 * first-party there and can be strict. The options must match exactly for clearing to work, so
 * setting and clearing share them.
 */
export function adminSessionCookieOptions(withLifetime: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: getOptionalEnv('NODE_ENV') === 'production',
    sameSite: 'strict',
    path: '/',
    ...(withLifetime ? { maxAge: ADMIN_SESSION_LIFETIME_S * 1000 } : {}),
  };
}
