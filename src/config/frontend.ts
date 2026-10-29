import { getOptionalEnv } from './env';

const DEFAULT_FRONTEND_URL = 'http://localhost:3001';

/** The web app's origin: what CORS admits, and what every link the API hands out leads to. */
export function frontendUrl(): string {
  return getOptionalEnv('FRONTEND_URL', DEFAULT_FRONTEND_URL);
}

/** An absolute link to a page of the web app, with `params` as its query string. */
export function frontendLink(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, frontendUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}
