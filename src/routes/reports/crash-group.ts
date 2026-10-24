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
 * What every occurrence of one crash shares, as it reads: its error name and normalised message.
 * The stack plays no part, so a crash keeps its report across deploys that move the code around.
 */
export function crashGroupKey(name: string, message: string): string {
  return normalizeMessage(`${name}: ${message}`).slice(0, GROUP_KEY_MAX_LENGTH);
}
