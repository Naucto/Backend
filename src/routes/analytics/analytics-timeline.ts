import { MetricPopulation } from './analytics-metrics';
import { DAY_MS, MINUTE_MS } from './analytics-time';

/**
 * The timeline reads raw analytics at any resolution from a minute to a day, so an admin can look
 * at what happened between two instants rather than between two UTC days. It never reads rollups:
 * its window is the raw retention, and its values are never final.
 */

export const TIMELINE_BUCKETS = {
  '1m': MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '1h': 60 * MINUTE_MS,
  '6h': 6 * 60 * MINUTE_MS,
  '1d': DAY_MS,
} as const;

export type TimelineBucket = keyof typeof TIMELINE_BUCKETS;

export const TIMELINE_BUCKET_NAMES = Object.keys(TIMELINE_BUCKETS) as TimelineBucket[];

export const MAX_TIMELINE_BUCKETS = 2_000;

/**
 * How the buckets of a window add up to the window.
 * - `sum`: the window's value is the sum of its buckets.
 * - `distinct`: a distinct count. The window counts each browser once, so it is computed apart.
 * - `max`: a peak of minute samples. The window takes the highest bucket.
 */
export type TimelineCombine = 'sum' | 'distinct' | 'max';

/** What a metric may be narrowed to. A metric ignores a filter it is not split by. */
export type TimelineFilter = 'release' | 'source';

export interface TimelineMetricDefinition {
  population: MetricPopulation;
  combine: TimelineCombine;
  filters: readonly TimelineFilter[];
  definition: string;
  /** Read from the minute presence samples: a bucket without one has no value, not 0. */
  sampled?: true;
}

export const TIMELINE_METRICS = {
  visitors_new: {
    population: 'C',
    combine: 'sum',
    filters: ['source'],
    definition:
      'Consenting browsers seen for the first time. A source narrows them to the source of their first session.',
  },
  sessions: {
    population: 'C',
    combine: 'sum',
    filters: ['source'],
    definition: 'Sessions of consenting browsers, at the instant they started.',
  },
  pageviews: {
    population: 'C',
    combine: 'sum',
    filters: ['source'],
    definition:
      'Page views of consenting browsers. A source narrows them to the source of their session.',
  },
  plays_consented: {
    population: 'C',
    combine: 'sum',
    filters: ['release', 'source'],
    definition:
      'Plays started by consenting browsers, at the instant Play was pressed. Reopened plays are not counted again.',
  },
  plays_anonymous: {
    population: 'A',
    combine: 'sum',
    filters: ['release'],
    definition:
      'Plays started in tabs that declined analytics or never answered, signed in or not. Identifier-free: one person restarting counts each time.',
  },
  plays_declined: {
    population: 'A',
    combine: 'sum',
    filters: ['release'],
    definition: 'Plays started in tabs that refused analytics.',
  },
  plays_unanswered: {
    population: 'A',
    combine: 'sum',
    filters: ['release'],
    definition: 'Plays started in tabs that have not answered the analytics question yet.',
  },
  plays_anonymous_signed_in: {
    population: 'A',
    combine: 'sum',
    filters: ['release'],
    definition:
      'Plays started in signed-in tabs that declined analytics or never answered. The account is never known.',
  },
  players: {
    population: 'C',
    combine: 'distinct',
    filters: ['release', 'source'],
    definition:
      'Distinct consenting browsers that started a play. A browser playing in two buckets counts in both, and once over the window.',
  },
  players_new: {
    population: 'C',
    combine: 'sum',
    filters: ['release', 'source'],
    definition:
      'Consenting browsers starting their first play kept in the raw window, or their first play of the game when one is chosen. A source narrows them to the source of their first session.',
  },
  signups: {
    population: 'F',
    combine: 'sum',
    filters: ['source'],
    definition:
      'Accounts created. A source narrows them to accounts linked to a consenting browser whose first session came from it.',
  },
  signups_unlinked: {
    population: 'F',
    combine: 'sum',
    filters: [],
    definition:
      'Accounts created that no consenting browser is linked to: they declined analytics, never answered, or have not been linked yet.',
  },
  projects_created: {
    population: 'F',
    combine: 'sum',
    filters: ['source'],
    definition:
      'Projects created. A source narrows them to creators whose linked browser came from it.',
  },
  projects_forked: {
    population: 'F',
    combine: 'sum',
    filters: ['release', 'source'],
    definition:
      'Projects created as a fork of a published game, of the chosen game when one is chosen. A fork deleted since is not counted.',
  },
  releases_published: {
    population: 'F',
    combine: 'sum',
    filters: ['release', 'source'],
    definition: 'Projects going from unpublished to published.',
  },
  releases_updated: {
    population: 'F',
    combine: 'sum',
    filters: ['release'],
    definition: 'Changes to a release that was already published.',
  },
  mp_sessions: {
    population: 'F',
    combine: 'sum',
    filters: ['release'],
    definition: 'Multiplayer rooms reaching two connected seats, editor tests excluded.',
  },
  mp_participants: {
    population: 'F',
    combine: 'sum',
    filters: ['release'],
    definition: 'Seats connecting to a multiplayer room for the first time, editor tests excluded.',
  },
  active_browsers: {
    population: 'C',
    combine: 'max',
    filters: [],
    definition: 'Highest number of consenting browsers active in one minute of the bucket.',
    sampled: true,
  },
  browsers_playing: {
    population: 'C',
    combine: 'max',
    filters: [],
    definition: 'Highest number of consenting browsers playing in one minute of the bucket.',
    sampled: true,
  },
  anon_tabs: {
    population: 'A',
    combine: 'max',
    filters: [],
    definition:
      'Highest number of anonymous pings in one minute of the bucket: an estimate of visible tabs that declined or never answered.',
    sampled: true,
  },
  anon_tabs_playing: {
    population: 'A',
    combine: 'max',
    filters: [],
    definition:
      'Highest number of anonymous pings from a running game in one minute of the bucket.',
    sampled: true,
  },
  anon_tabs_declined: {
    population: 'A',
    combine: 'max',
    filters: [],
    definition:
      'Highest number of anonymous pings in one minute of the bucket from tabs that refused analytics.',
  },
  anon_tabs_unanswered: {
    population: 'A',
    combine: 'max',
    filters: [],
    definition:
      'Highest number of anonymous pings in one minute of the bucket from tabs that have not answered yet.',
  },
  accounts_online: {
    population: 'PRESENCE',
    combine: 'max',
    filters: [],
    definition: 'Highest number of accounts holding an open app socket at a sample of the bucket.',
    sampled: true,
  },
} as const satisfies Record<string, TimelineMetricDefinition>;

export type TimelineMetric = keyof typeof TIMELINE_METRICS;

export const TIMELINE_METRIC_NAMES = Object.keys(TIMELINE_METRICS) as TimelineMetric[];

export const SOURCE_KINDS = ['referrer', 'utmSource', 'utmCampaign'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Where a consenting session came from. A null value is a session without one. */
export interface TimelineSource {
  kind: SourceKind;
  value: string | null;
}

export const NO_SOURCE_VALUE = '(none)';

/** `referrer:youtube.com`, `utmSource:newsletter`, or `referrer:(none)` for direct visits. */
export function parseSource(raw: string): TimelineSource | null {
  const separator = raw.indexOf(':');
  const kind = raw.slice(0, separator);
  const value = raw.slice(separator + 1);
  if (separator < 0 || !(SOURCE_KINDS as readonly string[]).includes(kind) || value === '') {
    return null;
  }
  return { kind: kind as SourceKind, value: value === NO_SOURCE_VALUE ? null : value };
}

export interface TimelineWindow {
  /** The first bucket's start, aligned to the bucket size. */
  from: Date;
  /** The end of the last bucket, excluded. */
  to: Date;
  bucketMs: number;
}

/**
 * The buckets covering `[from, to)`, aligned to multiples of their size since the epoch so that
 * the same instant always falls in the same bucket whatever window asked for it.
 */
export function windowOf(from: Date, to: Date, bucket: TimelineBucket): TimelineWindow {
  const bucketMs = TIMELINE_BUCKETS[bucket];
  const start = Math.floor(from.getTime() / bucketMs) * bucketMs;
  const end = Math.max(start + bucketMs, Math.ceil(to.getTime() / bucketMs) * bucketMs);
  return { from: new Date(start), to: new Date(end), bucketMs };
}

export function bucketStarts(window: TimelineWindow): Date[] {
  const starts: Date[] = [];
  for (let at = window.from.getTime(); at < window.to.getTime(); at += window.bucketMs) {
    starts.push(new Date(at));
  }
  return starts;
}

/** The finest bucket that keeps a window under a readable number of points. */
export function bucketFor(spanMs: number, points = 400): TimelineBucket {
  return (
    TIMELINE_BUCKET_NAMES.find((bucket) => spanMs / TIMELINE_BUCKETS[bucket] <= points) ?? '1d'
  );
}
