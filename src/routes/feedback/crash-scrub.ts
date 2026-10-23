/** A public profile's path, the one web route that names a person. */
const PROFILE_PATH = /\/u\/[^/?#\s)'"]+/g;
// Consume the whole URL even without a query, so nested schemes never trigger rescanning.
const URL_TEXT = /(?:https?|blob|file):\/\/[^\s)'"]*/gi;
const JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

function scrubUrl(url: string): string {
  const queryStart = url.search(/[?#]/);
  if (queryStart === -1) {
    return url;
  }

  // Keep up to two trailing :number fields (a stack frame's line and column).
  // Walking backwards avoids backtracking over attacker-controlled query text.
  let frameStart = url.length;
  for (let i = 0; i < 2; i++) {
    let digitStart = frameStart;
    while (digitStart > queryStart + 1) {
      const code = url.charCodeAt(digitStart - 1);
      if (code < 48 || code > 57) {
        break;
      }
      digitStart--;
    }
    if (digitStart === frameStart || url[digitStart - 1] !== ':') {
      break;
    }
    frameStart = digitStart - 1;
  }
  return url.slice(0, queryStart) + url.slice(frameStart);
}

/** A crash's page path without the username of a profile page. */
export function scrubRoute(route: string): string {
  return route.replace(PROFILE_PATH, '/u/:username');
}

/**
 * A stack without what can name someone: URL queries and fragments, tokens and profile paths.
 * Emails are left to `scrubMessage`: a Gecko frame (`fn@host/file.js`) reads like one.
 */
export function scrubStack(stack: string): string {
  return scrubRoute(stack.replace(URL_TEXT, scrubUrl).replace(JWT, '<token>'));
}

/** A crash message without what can name someone, emails included. */
export function scrubMessage(message: string): string {
  return scrubStack(message).replace(EMAIL, '<email>');
}
