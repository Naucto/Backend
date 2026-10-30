import { CrashSource } from '@prisma/client';

const GROUP_KEY_MAX_LENGTH = 300;

/**
 * A message with what varies between two occurrences of one crash taken out: addresses, long hex
 * or numeric ids and counts.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/(?:https?|blob|file):\/\/\S+/gi, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What every occurrence of one crash shares, as it reads: where it happened, its error name and
 * its normalised message. The stack plays no part, so a crash keeps its report across deploys that
 * move the code around. The source keeps a public browser report out of a backend crash that
 * happens to read the same.
 */
export function crashGroupKey(source: CrashSource, name: string, message: string): string {
  return `${source}:${normalizeMessage(`${name}: ${message}`)}`.slice(0, GROUP_KEY_MAX_LENGTH);
}
