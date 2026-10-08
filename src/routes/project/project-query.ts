/** A query parameter read as an integer, or undefined when it is missing or not a number. */
export function parseOptionalInt(value?: string): number | undefined {
  const parsed = value ? parseInt(value, 10) : NaN;
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function parseTags(tags?: string): string[] | undefined {
  return tags ? tags.split(',') : undefined;
}
