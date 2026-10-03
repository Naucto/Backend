import { CookieOptions } from 'express';

import { BadEnvVarError, getOptionalEnv } from '../config/env';

type TimeSpanUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'y';
type TimeSpanString = `${number}${TimeSpanUnit}`;
export type TimeSpan = number | TimeSpanString;

function isTimeSpanString(value: string): value is TimeSpanString {
  return /^\d+(s|m|h|d|w|y)$/.test(value);
}

function parseExpiresIn(
  varName: string,
  value: string | undefined,
  defaultValue: TimeSpan,
): TimeSpan {
  if (!value) {
    return defaultValue;
  }

  if (isTimeSpanString(value)) {
    return value;
  }

  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) {
    return asNumber;
  }

  throw new BadEnvVarError(varName);
}

const DEFAULT_ACCESS_TOKEN_LIFETIME: TimeSpan = '1h';
const DEFAULT_REFRESH_TOKEN_LIFETIME: TimeSpan = '7d';

export interface AuthLifetimes {
  accessToken: TimeSpan;
  refreshToken: TimeSpan;
}

/**
 * How long each token lives. The JWT `exp`, the stored refresh row's `expiresAt` and the cookie's
 * `maxAge` all derive from this one reading; an unreadable value throws.
 */
export function authLifetimes(): AuthLifetimes {
  return {
    accessToken: parseExpiresIn(
      'JWT_EXPIRES_IN',
      getOptionalEnv('JWT_EXPIRES_IN'),
      DEFAULT_ACCESS_TOKEN_LIFETIME,
    ),
    refreshToken: parseExpiresIn(
      'JWT_REFRESH_EXPIRES_IN',
      getOptionalEnv('JWT_REFRESH_EXPIRES_IN'),
      DEFAULT_REFRESH_TOKEN_LIFETIME,
    ),
  };
}

export function timespanToMs(value: TimeSpan): number {
  if (typeof value === 'number') {
    return value * 1000;
  }

  const match = value.match(/^(\d+)(s|m|h|d|w|y)$/);
  if (!match) {
    throw new Error(`Not a time span: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] as TimeSpanUnit;

  const multipliers: Record<TimeSpanUnit, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

export const REFRESH_COOKIE_NAME = 'refresh_token';

// Options shared by every place that sets or clears the refresh cookie: the
// attributes must match exactly for clearCookie() to take effect.
export function refreshCookieOptions(): CookieOptions {
  const isProd = getOptionalEnv('NODE_ENV') === 'production';

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/auth/refresh',
  };
}
