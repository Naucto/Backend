/**
 * A configuration value that must be a positive number, with a fallback.
 *
 * Blank is the case that matters. `.env.example` lists every key with an empty
 * value for a person to fill in, and copying it to `.env` — the documented way to
 * start — leaves those keys present and set to "". An empty string is not absent:
 * `Number("")` is 0, and `0 ?? 4` is 0, not 4. So a blank key silently became
 * zero: a save queue that refused every save, and a request timeout that was
 * then treated as "no timeout" by the HTTP handler, switching off the deadline
 * that was there for the opposite reason.
 *
 * So: absent, blank, unparseable, or not positive all fall back to the default.
 */
export function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}
