import { getOptionalEnv } from '../config/env';

function origin(): string {
  return getOptionalEnv('FRONTEND_URL', 'http://localhost:3001').replace(/\/+$/, '');
}

/** Where the web app shows something, for the admin console to link to. */
export const siteUrls = {
  profile: (username: string): string => `${origin()}/u/${encodeURIComponent(username)}`,
  play: (projectId: string): string => `${origin()}/play/${projectId}`,
  /** The editor, which loads read-only for staff who do not collaborate on the game. */
  edit: (projectId: string): string => `${origin()}/edit/${projectId}`,
};
