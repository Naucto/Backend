/** A valid, readable id for a fixture: `uuidOf(7)` is `00000000-0000-4000-8000-000000000007`. */
export function uuidOf(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
}
