/**
 * Stands for "no game" where a release id is part of a primary key, which a null cannot be. The
 * schema defaults of those columns spell the same value.
 */
export const NO_RELEASE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Orders two ids as Postgres orders `uuid`: byte by byte, which lower-case hex text reproduces.
 * The order means nothing; it only makes a tiebreak or a canonical pair agree with the database.
 */
export function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
