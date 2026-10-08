import { JwtPayload } from '../auth.types';

/**
 * The claims of the request's bearer token, read without verifying it: only call this once the JWT
 * strategy has accepted the request, which is what vouches for the signature.
 */
export function bearerClaims(request: {
  headers?: Record<string, string | string[] | undefined>;
}): Partial<JwtPayload> | null {
  const header = request.headers?.['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  const token = value?.startsWith('Bearer ') ? value.slice('Bearer '.length) : undefined;
  const payload = token?.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<JwtPayload>;
  } catch {
    return null;
  }
}
