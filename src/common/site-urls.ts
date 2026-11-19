import { getOptionalEnv } from '../config/env';

function origin(): string {
  return getOptionalEnv('FRONTEND_URL', 'http://localhost:3001').replace(/\/+$/, '');
}

/** Where the web app shows something, for the admin console to link to. */
export const siteUrls = {
  profile: (username: string): string => `${origin()}/u/${encodeURIComponent(username)}`,
  play: (projectId: number): string => `${origin()}/play/${String(projectId)}`,
  previewPlay: (projectId: number): string => `${origin()}/staff/play/${String(projectId)}`,
  previewEdit: (projectId: number): string => `${origin()}/staff/edit/${String(projectId)}`,
};
