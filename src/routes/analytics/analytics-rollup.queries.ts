import { AnalyticsFactType, Prisma } from '@prisma/client';

import { MetricName } from './analytics-metrics';

/**
 * The SQL behind every metric, one function per finalization class, each over a half-open range
 * of UTC days `[start, end)` given as `YYYY-MM-DD`. Every aggregate is cast to float8 or int, so no
 * BigInt or Decimal reaches the caller. They run inside the caller's transaction.
 */

export interface MetricValue {
  metric: MetricName;
  /** '' for the metric's total, otherwise `dimension:value`. */
  dimension: string;
  value: number;
}

export interface DayRange {
  start: string;
  end: string;
}

type Tx = Prisma.TransactionClient;

export const NONE_DIMENSION_VALUE = '(none)';

const total = (metric: MetricName, value: number): MetricValue => ({
  metric,
  dimension: '',
  value,
});

const split = (
  metric: MetricName,
  dimension: string,
  rows: { key: string | number | null; value: number }[],
): MetricValue[] =>
  rows.map((row) => ({
    metric,
    dimension: `${dimension}:${row.key === null ? NONE_DIMENSION_VALUE : String(row.key)}`,
    value: row.value,
  }));

const inDays = (column: Prisma.Sql, { start, end }: DayRange): Prisma.Sql =>
  Prisma.sql`${column} >= ${start}::date AND ${column} < ${end}::date`;

export async function activityMetrics(tx: Tx, range: DayRange): Promise<MetricValue[]> {
  const values: MetricValue[] = [];

  const routes = await tx.$queryRaw<{ key: string; value: number }[]>`
    SELECT "route" AS key, count(*)::float8 AS value FROM "AnalyticsPageView"
    WHERE ${inDays(Prisma.sql`"occurredAt"`, range)} GROUP BY "route"`;
  values.push(
    total(
      'pageviews',
      routes.reduce((sum, row) => sum + row.value, 0),
    ),
  );
  values.push(...split('pageviews', 'route', routes));

  const [minutes] = await tx.$queryRaw<[{ active: number; build: number }]>`
    SELECT COALESCE(sum(bit_count("activeBits")), 0)::float8 AS active,
           COALESCE(sum(bit_count("buildBits")), 0)::float8 AS build
    FROM "AnalyticsSessionDay" WHERE ${inDays(Prisma.sql`"day"`, range)}`;
  values.push(total('active_minutes', minutes.active), total('build_minutes', minutes.build));

  const plays = await tx.$queryRaw<{ key: number; value: number }[]>`
    SELECT key, sum(n)::float8 AS value FROM (
      SELECT "releaseId" AS key, count(*) AS n FROM "AnalyticsPlay"
      WHERE NOT "continued" AND ${inDays(Prisma.sql`"startedAt"`, range)} GROUP BY 1
      UNION ALL
      SELECT "releaseId", sum("playsStarted") FROM "AnalyticsAnonTally"
      WHERE "releaseId" <> 0 AND ${inDays(Prisma.sql`"minute"`, range)} GROUP BY 1
    ) AS counted GROUP BY key`;
  values.push(
    total(
      'plays',
      plays.reduce((sum, row) => sum + row.value, 0),
    ),
  );
  values.push(...split('plays', 'release', plays));

  const playtime = await tx.$queryRaw<{ key: number; value: number }[]>`
    SELECT key, sum(ms)::float8 AS value FROM (
      SELECT p."releaseId" AS key, sum(d."activeMs") AS ms
      FROM "AnalyticsPlayDay" d JOIN "AnalyticsPlay" p ON p.id = d."playId"
      WHERE ${inDays(Prisma.sql`d."day"`, range)} GROUP BY 1
      UNION ALL
      SELECT "releaseId", sum("playMs") FROM "AnalyticsAnonTally"
      WHERE "releaseId" <> 0 AND ${inDays(Prisma.sql`"minute"`, range)} GROUP BY 1
    ) AS credited GROUP BY key`;
  values.push(
    total(
      'playtime_ms',
      playtime.reduce((sum, row) => sum + row.value, 0),
    ),
  );
  values.push(...split('playtime_ms', 'release', playtime));

  const [visitors] = await tx.$queryRaw<
    [{ visitors: number; fresh: number; returning: number; accounts: number }]
  >`
    WITH active AS (
      SELECT DISTINCT s."visitorId" FROM "AnalyticsSessionDay" d
      JOIN "AnalyticsSession" s ON s.id = d."sessionId"
      WHERE ${inDays(Prisma.sql`d."day"`, range)}
    )
    SELECT count(*)::float8 AS visitors,
           count(*) FILTER (WHERE v."firstSeenAt" >= ${range.start}::date)::float8 AS fresh,
           count(*) FILTER (WHERE v."firstSeenAt" < ${range.start}::date)::float8 AS returning,
           count(DISTINCT v."userId")::float8 AS accounts
    FROM active a JOIN "AnalyticsVisitor" v ON v.id = a."visitorId"`;
  values.push(
    total('visitors', visitors.visitors),
    total('visitors_new', visitors.fresh),
    total('visitors_returning', visitors.returning),
    total('accounts_active', visitors.accounts),
  );

  const players = await tx.$queryRaw<{ key: number | null; value: number }[]>`
    WITH played AS (
      SELECT s."visitorId", p."releaseId" FROM "AnalyticsPlay" p
      JOIN "AnalyticsSession" s ON s.id = p."sessionId"
      WHERE ${inDays(Prisma.sql`p."startedAt"`, range)}
      UNION
      SELECT s."visitorId", p."releaseId" FROM "AnalyticsPlayDay" d
      JOIN "AnalyticsPlay" p ON p.id = d."playId"
      JOIN "AnalyticsSession" s ON s.id = p."sessionId"
      WHERE d."activeMs" > 0 AND ${inDays(Prisma.sql`d."day"`, range)}
    )
    SELECT "releaseId" AS key, count(DISTINCT "visitorId")::float8 AS value
    FROM played GROUP BY GROUPING SETS (("releaseId"), ())`;
  // The grouping set () is every player once, never the sum of the per-game counts.
  values.push(total('players', players.find((row) => row.key === null)?.value ?? 0));
  values.push(
    ...split(
      'players',
      'release',
      players.filter((row) => row.key !== null),
    ),
  );

  const [builders] = await tx.$queryRaw<[{ value: number }]>`
    SELECT count(DISTINCT v."userId")::float8 AS value FROM "AnalyticsSessionDay" d
    JOIN "AnalyticsSession" s ON s.id = d."sessionId"
    JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
    WHERE v."userId" IS NOT NULL AND bit_count(d."buildBits") > 0
      AND ${inDays(Prisma.sql`d."day"`, range)}`;
  values.push(total('builders_active', builders.value));

  return values;
}

/** Session columns a breakdown can split by, keyed by the dimension the registry names. */
const SESSION_DIMENSION_COLUMNS = {
  country: Prisma.raw('"country"'),
  device: Prisma.raw('"device"'),
  browser: Prisma.raw('"browser"'),
  os: Prisma.raw('"os"'),
  screen: Prisma.raw('"screen"'),
  language: Prisma.raw('"language"'),
  referrer: Prisma.raw('"referrerDomain"'),
  utmSource: Prisma.raw('"utmSource"'),
  utmCampaign: Prisma.raw('"utmCampaign"'),
} as const;

export async function sessionMetrics(tx: Tx, range: DayRange): Promise<MetricValue[]> {
  const [summary] = await tx.$queryRaw<
    [{ sessions: number; bounced: number; seconds: number; median: number | null }]
  >`
    WITH started AS (
      SELECT s.id,
             EXTRACT(EPOCH FROM (
               LEAST(COALESCE(s."closedAt", s."lastSeenAt"), s."startedAt" + interval '12 hours')
               - s."startedAt"
             ))::float8 AS seconds,
             (SELECT count(*) FROM "AnalyticsPageView" v WHERE v."sessionId" = s.id) AS views,
             EXISTS (SELECT 1 FROM "AnalyticsPlay" p WHERE p."sessionId" = s.id) AS played
      FROM "AnalyticsSession" s
      WHERE ${inDays(Prisma.sql`s."startedAt"`, range)}
    )
    SELECT count(*)::float8 AS sessions,
           count(*) FILTER (WHERE views = 1 AND NOT played)::float8 AS bounced,
           COALESCE(sum(seconds), 0)::float8 AS seconds,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds)::float8 AS median
    FROM started`;

  const values: MetricValue[] = [
    total('sessions', summary.sessions),
    total('sessions_bounced', summary.bounced),
    total('session_seconds_total', summary.seconds),
  ];
  // No session, no median: the value stays absent rather than zero.
  if (summary.median !== null) {
    values.push(total('session_seconds_median', summary.median));
  }

  for (const [dimension, column] of Object.entries(SESSION_DIMENSION_COLUMNS)) {
    const rows = await tx.$queryRaw<{ key: string | null; value: number }[]>`
      SELECT ${column} AS key, count(*)::float8 AS value FROM "AnalyticsSession"
      WHERE ${inDays(Prisma.sql`"startedAt"`, range)} GROUP BY ${column}`;
    values.push(...split('sessions', dimension, rows));
  }
  return values;
}

const FACT_METRICS: Record<AnalyticsFactType, MetricName> = {
  SIGNUP: 'signups',
  PROJECT_CREATED: 'projects_created',
  RELEASE_PUBLISHED: 'releases_published',
  RELEASE_UPDATED: 'releases_updated',
  RELEASE_UNPUBLISHED: 'releases_unpublished',
};

export async function factMetrics(tx: Tx, range: DayRange): Promise<MetricValue[]> {
  const rows = await tx.$queryRaw<{ type: AnalyticsFactType; value: number }[]>`
    SELECT "type", count(*)::float8 AS value FROM "AnalyticsFact"
    WHERE ${inDays(Prisma.sql`"at"`, range)} GROUP BY "type"`;
  return Object.entries(FACT_METRICS).map(([type, metric]) =>
    total(metric, rows.find((row) => row.type === type)?.value ?? 0),
  );
}

export async function multiplayerMetrics(tx: Tx, range: DayRange): Promise<MetricValue[]> {
  const [counts] = await tx.$queryRaw<
    [
      {
        created: number;
        connected: number;
        participants: number;
        minutes: number;
        playerMinutes: number;
      },
    ]
  >`
    SELECT
      (SELECT count(*) FROM "AnalyticsMpSession"
        WHERE NOT "editorTest" AND ${inDays(Prisma.sql`"createdAt"`, range)})::float8 AS created,
      (SELECT count(*) FROM "AnalyticsMpSession"
        WHERE NOT "editorTest" AND ${inDays(Prisma.sql`"firstConnectedAt"`, range)})::float8 AS connected,
      (SELECT count(*) FROM "AnalyticsMpSeat" seat
        JOIN "AnalyticsMpSession" m ON m.id = seat."sessionId"
        WHERE NOT m."editorTest" AND ${inDays(Prisma.sql`seat."firstConnectedAt"`, range)})::float8 AS participants,
      (SELECT COALESCE(sum(d."multiMs"), 0) FROM "AnalyticsMpDay" d
        JOIN "AnalyticsMpSession" m ON m.id = d."sessionId"
        WHERE NOT m."editorTest" AND ${inDays(Prisma.sql`d."day"`, range)})::float8 / 60000 AS minutes,
      (SELECT COALESCE(sum(d."playerMs"), 0) FROM "AnalyticsMpDay" d
        JOIN "AnalyticsMpSession" m ON m.id = d."sessionId"
        WHERE NOT m."editorTest" AND ${inDays(Prisma.sql`d."day"`, range)})::float8 / 60000 AS "playerMinutes"`;

  const sessions = await tx.$queryRaw<{ key: number; value: number }[]>`
    SELECT "projectId" AS key, count(*)::float8 AS value FROM "AnalyticsMpSession"
    WHERE NOT "editorTest" AND ${inDays(Prisma.sql`"reachedMultiAt"`, range)} GROUP BY "projectId"`;

  return [
    total('mp_rooms_created', counts.created),
    total('mp_rooms_connected', counts.connected),
    total(
      'mp_sessions',
      sessions.reduce((sum, row) => sum + row.value, 0),
    ),
    ...split('mp_sessions', 'release', sessions),
    total('mp_participants', counts.participants),
    total('mp_minutes', counts.minutes),
    total('mp_player_minutes', counts.playerMinutes),
  ];
}

interface PresencePeaks {
  sampled: number;
  browsers: number | null;
  browsersPlaying: number | null;
  browsersBuilding: number | null;
  browsersHosting: number | null;
  browsersBrowsing: number | null;
  anon: number | null;
  anonPlaying: number | null;
  anonBuilding: number | null;
  anonHosting: number | null;
  anonBrowsing: number | null;
  accounts: number | null;
  accountsPlaying: number | null;
  accountsBuilding: number | null;
  accountsHosting: number | null;
  accountsBrowsing: number | null;
  browserMinutes: number;
  anonMinutes: number;
}

export async function presenceMetrics(tx: Tx, range: DayRange): Promise<MetricValue[]> {
  const [peaks] = await tx.$queryRaw<[PresencePeaks]>`
    SELECT count(*)::float8 AS sampled,
      max("activeBrowsers")::float8 AS browsers,
      max("activeBrowsersPlaying")::float8 AS "browsersPlaying",
      max("activeBrowsersBuilding")::float8 AS "browsersBuilding",
      max("activeBrowsersHosting")::float8 AS "browsersHosting",
      max("activeBrowsers" - "activeBrowsersPlaying" - "activeBrowsersBuilding" - "activeBrowsersHosting")::float8 AS "browsersBrowsing",
      max("anonTabs")::float8 AS anon,
      max("anonTabsPlaying")::float8 AS "anonPlaying",
      max("anonTabsBuilding")::float8 AS "anonBuilding",
      max("anonTabsHosting")::float8 AS "anonHosting",
      max("anonTabs" - "anonTabsPlaying" - "anonTabsBuilding" - "anonTabsHosting")::float8 AS "anonBrowsing",
      max("accounts")::float8 AS accounts,
      max("accountsPlaying")::float8 AS "accountsPlaying",
      max("accountsBuilding")::float8 AS "accountsBuilding",
      max("accountsHosting")::float8 AS "accountsHosting",
      max("accounts" - "accountsPlaying" - "accountsBuilding" - "accountsHosting")::float8 AS "accountsBrowsing",
      COALESCE(sum("activeBrowsers"), 0)::float8 AS "browserMinutes",
      COALESCE(sum("anonTabs"), 0)::float8 AS "anonMinutes"
    FROM "ConcurrencySample" WHERE ${inDays(Prisma.sql`"at"`, range)}`;

  const values: MetricValue[] = [
    total('presence_minutes_sampled', peaks.sampled),
    total('active_browser_minutes', peaks.browserMinutes),
    total('anon_tab_minutes', peaks.anonMinutes),
  ];
  // Without a sample there is no peak: absent, not zero.
  if (peaks.sampled === 0) {
    return values;
  }

  const byState = (
    metric: MetricName,
    peak: number | null,
    playing: number | null,
    building: number | null,
    hosting: number | null,
    browsing: number | null,
  ): MetricValue[] => [
    total(metric, peak ?? 0),
    ...split(metric, 'state', [
      { key: 'PLAYING', value: playing ?? 0 },
      { key: 'BUILDING', value: building ?? 0 },
      { key: 'HOSTING', value: hosting ?? 0 },
      { key: 'BROWSING', value: browsing ?? 0 },
    ]),
  ];
  values.push(
    ...byState(
      'active_browsers_peak',
      peaks.browsers,
      peaks.browsersPlaying,
      peaks.browsersBuilding,
      peaks.browsersHosting,
      peaks.browsersBrowsing,
    ),
    ...byState(
      'anon_tabs_peak',
      peaks.anon,
      peaks.anonPlaying,
      peaks.anonBuilding,
      peaks.anonHosting,
      peaks.anonBrowsing,
    ),
    ...byState(
      'accounts_peak',
      peaks.accounts,
      peaks.accountsPlaying,
      peaks.accountsBuilding,
      peaks.accountsHosting,
      peaks.accountsBrowsing,
    ),
  );

  const hours = await tx.$queryRaw<
    { hour: number; browsers: number; anon: number; accounts: number }[]
  >`
    SELECT EXTRACT(HOUR FROM "at")::int AS hour,
           max("activeBrowsers")::float8 AS browsers,
           max("anonTabs")::float8 AS anon,
           max("accounts")::float8 AS accounts
    FROM "ConcurrencySample" WHERE ${inDays(Prisma.sql`"at"`, range)} GROUP BY 1`;
  values.push(
    ...split(
      'active_browsers_peak',
      'hour',
      hours.map((row) => ({ key: row.hour, value: row.browsers })),
    ),
    ...split(
      'anon_tabs_peak',
      'hour',
      hours.map((row) => ({ key: row.hour, value: row.anon })),
    ),
    ...split(
      'accounts_peak',
      'hour',
      hours.map((row) => ({ key: row.hour, value: row.accounts })),
    ),
  );
  return values;
}

/** Sampled minutes over the minutes of the range: whether we were measuring, not completeness. */
export async function samplerCoverage(tx: Tx, range: DayRange): Promise<number> {
  const [row] = await tx.$queryRaw<[{ sampled: number; minutes: number }]>`
    SELECT count(*)::float8 AS sampled,
           (EXTRACT(EPOCH FROM (${range.end}::date::timestamp - ${range.start}::date::timestamp)) / 60)::float8 AS minutes
    FROM "ConcurrencySample" WHERE ${inDays(Prisma.sql`"at"`, range)}`;
  return row.minutes > 0 ? row.sampled / row.minutes : 0;
}

/** Refused, throttled and failed reports over all reports received in the range. */
export async function ingestErrorRate(tx: Tx, range: DayRange): Promise<number> {
  const [row] = await tx.$queryRaw<[{ failed: number; received: number }]>`
    SELECT COALESCE(sum("rejected" + "throttled" + "writeErrors"), 0)::float8 AS failed,
           COALESCE(sum("accepted" + "rejected" + "throttled" + "writeErrors"), 0)::float8 AS received
    FROM "AnalyticsIngestStat" WHERE ${inDays(Prisma.sql`"minute"`, range)}`;
  return row.received > 0 ? row.failed / row.received : 0;
}

/** The first day holding raw data of each class, or null when there is none. */
export async function earliestRawDay(
  tx: Tx,
): Promise<Record<'ACTIVITY' | 'SESSION' | 'FACT' | 'MULTIPLAYER' | 'PRESENCE', string | null>> {
  const [row] = await tx.$queryRaw<
    [
      {
        activity: string | null;
        session: string | null;
        fact: string | null;
        multiplayer: string | null;
        presence: string | null;
      },
    ]
  >`
    SELECT to_char(LEAST(
             (SELECT min("day") FROM "AnalyticsSessionDay"),
             (SELECT min("minute")::date FROM "AnalyticsAnonTally"),
             (SELECT min("occurredAt")::date FROM "AnalyticsPageView")
           ), 'YYYY-MM-DD') AS activity,
           to_char((SELECT min("startedAt")::date FROM "AnalyticsSession"), 'YYYY-MM-DD') AS session,
           to_char((SELECT min("at")::date FROM "AnalyticsFact"), 'YYYY-MM-DD') AS fact,
           to_char(LEAST(
             (SELECT min("createdAt")::date FROM "AnalyticsMpSession"),
             (SELECT min("day") FROM "AnalyticsMpDay")
           ), 'YYYY-MM-DD') AS multiplayer,
           to_char((SELECT min("at")::date FROM "ConcurrencySample"), 'YYYY-MM-DD') AS presence`;
  return {
    ACTIVITY: row.activity,
    SESSION: row.session,
    FACT: row.fact,
    MULTIPLAYER: row.multiplayer,
    PRESENCE: row.presence,
  };
}

/**
 * Builds or matures the retention cohorts touched by day `day` becoming final for activity: the
 * cohort of that day gets its size, and each cohort whose offset lands on that day gets its count.
 */
export async function rollupCohorts(
  tx: Tx,
  day: string,
  offsets: readonly number[],
  version: number,
): Promise<void> {
  // VISITOR: consenting browsers first seen and active on the cohort day.
  await tx.$executeRaw`
    INSERT INTO "AnalyticsCohort" ("kind", "version", "cohortDay", "offsetDays", "size", "retained", "mature")
    SELECT 'VISITOR', ${version}, ${day}::date, o.n, count(DISTINCT v.id)::int, NULL, false
    FROM unnest(${offsets as number[]}::int[]) AS o(n)
    LEFT JOIN "AnalyticsVisitor" v ON v."firstSeenAt" >= ${day}::date AND v."firstSeenAt" < ${day}::date + 1
      AND EXISTS (
        SELECT 1 FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
        WHERE s."visitorId" = v.id AND d."day" = ${day}::date
      )
    GROUP BY o.n
    ON CONFLICT ("kind", "version", "cohortDay", "offsetDays") DO UPDATE SET "size" = EXCLUDED."size"`;

  // ACCOUNT: accounts signed up on the cohort day with a linked consenting browser active that day.
  await tx.$executeRaw`
    INSERT INTO "AnalyticsCohort" ("kind", "version", "cohortDay", "offsetDays", "size", "retained", "mature")
    SELECT 'ACCOUNT', ${version}, ${day}::date, o.n, count(DISTINCT f."actorUserId")::int, NULL, false
    FROM unnest(${offsets as number[]}::int[]) AS o(n)
    LEFT JOIN "AnalyticsFact" f ON f."type" = 'SIGNUP' AND f."actorUserId" IS NOT NULL
      AND f."at" >= ${day}::date AND f."at" < ${day}::date + 1
      AND EXISTS (
        SELECT 1 FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
        JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
        WHERE v."userId" = f."actorUserId" AND d."day" = ${day}::date
      )
    GROUP BY o.n
    ON CONFLICT ("kind", "version", "cohortDay", "offsetDays") DO UPDATE SET "size" = EXCLUDED."size"`;

  // Matures every cohort whose return day is this day.
  await tx.$executeRaw`
    UPDATE "AnalyticsCohort" c SET "mature" = true, "retained" = (
      CASE c."kind"
        WHEN 'VISITOR' THEN (
          SELECT count(DISTINCT v.id)::int FROM "AnalyticsVisitor" v
          WHERE v."firstSeenAt" >= c."cohortDay" AND v."firstSeenAt" < c."cohortDay" + 1
            AND EXISTS (
              SELECT 1 FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
              WHERE s."visitorId" = v.id AND d."day" = c."cohortDay")
            AND EXISTS (
              SELECT 1 FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
              WHERE s."visitorId" = v.id AND d."day" = ${day}::date))
        ELSE (
          SELECT count(DISTINCT f."actorUserId")::int FROM "AnalyticsFact" f
          WHERE f."type" = 'SIGNUP' AND f."actorUserId" IS NOT NULL
            AND f."at" >= c."cohortDay" AND f."at" < c."cohortDay" + 1
            AND EXISTS (
              SELECT 1 FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
              JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
              WHERE v."userId" = f."actorUserId" AND d."day" = c."cohortDay")
            AND EXISTS (
              SELECT 1 FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
              JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
              WHERE v."userId" = f."actorUserId" AND d."day" = ${day}::date))
      END)
    WHERE c."version" = ${version} AND NOT c."mature" AND c."cohortDay" + c."offsetDays" = ${day}::date`;
}
