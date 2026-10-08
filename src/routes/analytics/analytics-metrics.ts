/**
 * Who a metric counts. Metrics never mix populations silently: a metric over `C_AND_A` says so.
 * - `C`: browsers that granted analytics consent, identified by their visitor cookie.
 * - `C_LINKED`: consenting browsers linked to an account.
 * - `A`: tabs that declined or never answered; they send identifier-free pings only.
 * - `F`: server-side business facts and multiplayer rooms, for every account.
 * - `PRESENCE`: accounts holding an open app socket, as `PresenceService` sees them.
 */
export type MetricPopulation = 'C' | 'C_LINKED' | 'A' | 'C_AND_A' | 'F' | 'PRESENCE';

/**
 * How values combine across days.
 * - `additive`: stored per day, summed exactly for any range.
 * - `max`: stored per day, the range takes the largest.
 * - `perGrain`: a distinct count or median; stored per DAY, WEEK and MONTH when the period
 *   finalizes, since it cannot be rebuilt from daily values.
 */
export type MetricKind = 'additive' | 'max' | 'perGrain';

/**
 * When a day's value stops changing, so it can be finalized:
 * - `ACTIVITY`, `FACT`, `MULTIPLAYER`, `PRESENCE`: D+1 01:05 UTC.
 * - `SESSION`: D+2 01:05 UTC, after every session started on D has closed (12 h cap, 35 min idle).
 * - `COHORT`: once day C+n is final for `ACTIVITY`.
 */
export type FinalizationClass =
  | 'ACTIVITY'
  | 'SESSION'
  | 'FACT'
  | 'MULTIPLAYER'
  | 'PRESENCE'
  | 'COHORT';

export type MetricDimension =
  | 'route'
  | 'release'
  | 'country'
  | 'device'
  | 'browser'
  | 'os'
  | 'screen'
  | 'language'
  | 'referrer'
  | 'utmSource'
  | 'utmCampaign'
  | 'state'
  | 'hour';

export interface MetricDefinition {
  population: MetricPopulation;
  kind: MetricKind;
  finalization: FinalizationClass;
  /** Bumped whenever the definition changes; values of different versions are never combined. */
  version: number;
  dimensions: readonly MetricDimension[];
  definition: string;
}

/** Dimensions whose values are unbounded, kept as the top N of each period plus `(other)`. */
export const TRUNCATED_DIMENSIONS: Readonly<Partial<Record<MetricDimension, number>>> = {
  referrer: 100,
  utmSource: 100,
  utmCampaign: 100,
  route: 50,
};

export const OTHER_DIMENSION_VALUE = '(other)';

const SESSION_DIMENSIONS = [
  'country',
  'device',
  'browser',
  'os',
  'screen',
  'language',
  'referrer',
  'utmSource',
  'utmCampaign',
] as const satisfies readonly MetricDimension[];

const PRESENCE_DIMENSIONS = ['state', 'hour'] as const satisfies readonly MetricDimension[];

export const METRICS = {
  pageviews: {
    population: 'C',
    kind: 'additive',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: ['route'],
    definition:
      'Finished navigations to a new path (query and fragment ignored), outside oauth/**, credited on the UTC day they occurred.',
  },
  sessions: {
    population: 'C',
    kind: 'additive',
    finalization: 'SESSION',
    version: 1,
    dimensions: SESSION_DIMENSIONS,
    definition:
      'Sessions started on the day. A session ends after 30 min without activity and lasts at most 12 h.',
  },
  sessions_bounced: {
    population: 'C',
    kind: 'additive',
    finalization: 'SESSION',
    version: 1,
    dimensions: [],
    definition: 'Closed sessions started on the day with exactly one page view and no play.',
  },
  session_seconds_total: {
    population: 'C',
    kind: 'additive',
    finalization: 'SESSION',
    version: 1,
    dimensions: [],
    definition:
      'Sum of the durations of sessions started on the day, from first to last activity received.',
  },
  session_seconds_median: {
    population: 'C',
    kind: 'perGrain',
    finalization: 'SESSION',
    version: 1,
    dimensions: [],
    definition: 'Median duration of the sessions started in the period.',
  },
  active_minutes: {
    population: 'C',
    kind: 'additive',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: [],
    definition:
      'UTC minutes in which a session sent a beat or a page view, each minute counted once per session however many tabs were open.',
  },
  build_minutes: {
    population: 'C',
    kind: 'additive',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: [],
    definition: 'Active minutes in which the session was in the editor.',
  },
  plays: {
    population: 'C_AND_A',
    kind: 'additive',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: ['release'],
    definition:
      'Presses of Play on a published game that started it running, a restart counting as a new play. Plays reopened after a consent, identity or session change are not counted again.',
  },
  playtime_ms: {
    population: 'C_AND_A',
    kind: 'additive',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: ['release'],
    definition:
      'Time a published game ran in a visible tab, credited on the UTC day the server received each progress report.',
  },
  visitors: {
    population: 'C',
    kind: 'perGrain',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: [],
    definition: 'Distinct consenting browsers with a page view or a beat in the period.',
  },
  visitors_new: {
    population: 'C',
    kind: 'perGrain',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: [],
    definition: 'Visitors first seen in the period.',
  },
  visitors_returning: {
    population: 'C',
    kind: 'perGrain',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: [],
    definition: 'Visitors first seen before the period.',
  },
  players: {
    population: 'C',
    kind: 'perGrain',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: ['release'],
    definition:
      'Distinct consenting browsers with a play started or playtime credited in the period. Per-release values are never summed into the total.',
  },
  accounts_active: {
    population: 'C_LINKED',
    kind: 'perGrain',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: [],
    definition:
      'Distinct accounts with an active linked consenting browser in the period. Accounts that declined are not seen.',
  },
  builders_active: {
    population: 'C_LINKED',
    kind: 'perGrain',
    finalization: 'ACTIVITY',
    version: 1,
    dimensions: [],
    definition: 'Distinct accounts with at least one build minute in the period.',
  },
  signups: {
    population: 'F',
    kind: 'additive',
    finalization: 'FACT',
    version: 1,
    dimensions: [],
    definition: 'Accounts created on the day, by password or by OAuth.',
  },
  projects_created: {
    population: 'F',
    kind: 'additive',
    finalization: 'FACT',
    version: 1,
    dimensions: [],
    definition: 'Projects created on the day. Later deletion does not change the count.',
  },
  releases_published: {
    population: 'F',
    kind: 'additive',
    finalization: 'FACT',
    version: 1,
    dimensions: [],
    definition: 'Transitions of a project from unpublished to published.',
  },
  releases_updated: {
    population: 'F',
    kind: 'additive',
    finalization: 'FACT',
    version: 1,
    dimensions: [],
    definition:
      'Changes to the content or published metadata of a release that was already published. Republishing identical content is not counted.',
  },
  releases_unpublished: {
    population: 'F',
    kind: 'additive',
    finalization: 'FACT',
    version: 1,
    dimensions: [],
    definition: 'Transitions of a project from published to unpublished.',
  },
  mp_rooms_created: {
    population: 'F',
    kind: 'additive',
    finalization: 'MULTIPLAYER',
    version: 1,
    dimensions: [],
    definition: 'Multiplayer rooms created through the API, editor tests excluded.',
  },
  mp_rooms_connected: {
    population: 'F',
    kind: 'additive',
    finalization: 'MULTIPLAYER',
    version: 1,
    dimensions: [],
    definition: 'Rooms whose first socket connected on the day, editor tests excluded.',
  },
  mp_sessions: {
    population: 'F',
    kind: 'additive',
    finalization: 'MULTIPLAYER',
    version: 1,
    dimensions: ['release'],
    definition:
      'Rooms that first had two or more seats connected at once on the day, editor tests excluded.',
  },
  mp_participants: {
    population: 'F',
    kind: 'additive',
    finalization: 'MULTIPLAYER',
    version: 1,
    dimensions: [],
    definition:
      'Seats that connected to a room for the first time on the day, counted once per room. A seat reconnecting after a backend restart may count twice.',
  },
  mp_minutes: {
    population: 'F',
    kind: 'additive',
    finalization: 'MULTIPLAYER',
    version: 1,
    dimensions: [],
    definition: 'Wall-clock minutes with two or more seats connected to a room.',
  },
  mp_player_minutes: {
    population: 'F',
    kind: 'additive',
    finalization: 'MULTIPLAYER',
    version: 1,
    dimensions: [],
    definition: 'Sum of the connected time of every seat.',
  },
  active_browsers_peak: {
    population: 'C',
    kind: 'max',
    finalization: 'PRESENCE',
    version: 1,
    dimensions: PRESENCE_DIMENSIONS,
    definition:
      'Highest number of distinct consenting browsers with a beat in one UTC minute, each counted once in its highest state. Minute-active, not instantaneous.',
  },
  anon_tabs_peak: {
    population: 'A',
    kind: 'max',
    finalization: 'PRESENCE',
    version: 1,
    dimensions: PRESENCE_DIMENSIONS,
    definition:
      'Highest number of anonymous pings received in one UTC minute: an estimate of visible anonymous tabs, where one person with three tabs counts three times.',
  },
  accounts_peak: {
    population: 'PRESENCE',
    kind: 'max',
    finalization: 'PRESENCE',
    version: 1,
    dimensions: PRESENCE_DIMENSIONS,
    definition:
      'Highest number of accounts holding an open app socket at a sample, hidden tabs included. The only instantaneous series.',
  },
  presence_minutes_sampled: {
    population: 'PRESENCE',
    kind: 'additive',
    finalization: 'PRESENCE',
    version: 1,
    dimensions: [],
    definition:
      'Minutes for which a presence sample exists; the denominator of every presence mean.',
  },
  active_browser_minutes: {
    population: 'C',
    kind: 'additive',
    finalization: 'PRESENCE',
    version: 1,
    dimensions: [],
    definition: 'Sum over sampled minutes of the minute-active browsers.',
  },
  anon_tab_minutes: {
    population: 'A',
    kind: 'additive',
    finalization: 'PRESENCE',
    version: 1,
    dimensions: [],
    definition: 'Sum over sampled minutes of the anonymous pings.',
  },
} as const satisfies Record<string, MetricDefinition>;

export type MetricName = keyof typeof METRICS;

export const METRIC_NAMES = Object.keys(METRICS) as MetricName[];

export type RetentionKind = 'VISITOR' | 'ACCOUNT';

export const RETENTION_OFFSETS = [1, 7, 30] as const;

/** Bumped whenever a cohort definition changes; cohorts of different versions are never combined. */
export const RETENTION_VERSION = 1;

/**
 * Stated by the metric registry: final values hold no identifiers and are never rewritten, so an
 * erasure only changes periods finalized after it.
 */
export const ERASURE_CONTRACT =
  'Final values hold no identifiers and are never rewritten. An erasure only affects periods finalized after it, so grains finalized on different dates can describe slightly different retained populations.';
