/** Every analytics day and minute is UTC. */

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** How far back an event may say it happened; older ones arrived too late to trust. */
export const MAX_EVENT_AGE_MS = 15 * MINUTE_MS;
/** Slack allowed on reported running time, for clocks and transit. */
export const PROGRESS_SLACK_MS = 5_000;
/** A session ends after this long without activity, a little over the client's 30 minutes. */
export const SESSION_IDLE_MS = 35 * MINUTE_MS;
/** A session never lasts longer than this. */
export const SESSION_MAX_MS = 12 * 60 * MINUTE_MS;
/** A visitor cookie lives this long and is never extended. */
export const VISITOR_COOKIE_MS = 395 * DAY_MS;

/** Minutes in a day, one bit each in a session-day bitmap. */
export const MINUTES_PER_DAY = 1_440;

/** The UTC day of an instant, as `YYYY-MM-DD`. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

/** The instant an instant's UTC minute starts. */
export const minuteStart = (at: Date): Date =>
  new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);

/** The index, 0 to 1439, of an instant's minute within its UTC day. */
export const minuteOfDay = (at: Date): number => at.getUTCHours() * 60 + at.getUTCMinutes();
