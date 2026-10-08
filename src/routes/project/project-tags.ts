import { PROJECT_MAX_TAGS } from './dto/project-field-limits';

/**
 * Trims, drops empties, keeps at most `PROJECT_MAX_TAGS`, and drops a tag that repeats an
 * earlier one in another case.
 */
export function normalizeTags(tags?: string[]): string[] {
  if (!tags) {
    return [];
  }

  const normalized = tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, PROJECT_MAX_TAGS);

  return normalized.filter(
    (tag, index, array) =>
      array.findIndex((candidate) => candidate.toLocaleLowerCase() === tag.toLocaleLowerCase()) ===
      index,
  );
}
