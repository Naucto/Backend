/** A public profile's path, the one web route that names a person. */
const PROFILE_PATH = /\/u\/[^/?#\s)'"]+/g;
const URL_QUERY =
  /((?:https?|blob|file):\/\/[^\s?#)'"]*)[?#][^\s)'"]*?(?=(?::\d+){0,2}(?:[\s)'"]|$))/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

/** A crash's page path without the username of a profile page. */
export function scrubRoute(route: string): string {
  return route.replace(PROFILE_PATH, '/u/:username');
}

/**
 * A stack without what can name someone: URL queries and fragments, tokens and profile paths.
 * Emails are left to `scrubMessage`: a Gecko frame (`fn@host/file.js`) reads like one.
 */
export function scrubStack(stack: string): string {
  return scrubRoute(stack.replace(URL_QUERY, '$1').replace(JWT, '<token>'));
}

/** A crash message without what can name someone, emails included. */
export function scrubMessage(message: string): string {
  return scrubStack(message).replace(EMAIL, '<email>');
}
