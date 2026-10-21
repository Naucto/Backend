import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { TimelineMetric, TimelineSource } from './analytics-timeline';

/**
 * The SQL behind every timeline metric, over raw rows in `[from, to)`. Each query answers one row
 * per slot that holds something: with a slot size, the slot is the bucket's index since the epoch;
 * without one, every row falls in slot 0, which is how a distinct count over a whole window is
 * read. Timestamps are stored as UTC without a zone, so their epoch is UTC.
 */

export interface TimelineRange {
  from: Date;
  to: Date;
  /** Null reads the whole range as one slot. */
  slotMs: number | null;
}

export interface TimelineFilters {
  releaseId?: number;
  source?: TimelineSource;
}

export interface SlotValue {
  slot: number;
  value: number;
}

type Query = (
  prisma: PrismaService,
  range: TimelineRange,
  filters: TimelineFilters,
) => Promise<SlotValue[]>;

const slotOf = (column: Prisma.Sql, range: TimelineRange): Prisma.Sql =>
  range.slotMs === null
    ? Prisma.sql`0::float8`
    : Prisma.sql`floor(extract(epoch FROM ${column}) * 1000 / ${range.slotMs})::float8`;

const within = (column: Prisma.Sql, range: TimelineRange): Prisma.Sql =>
  Prisma.sql`${column} >= ${range.from} AND ${column} < ${range.to}`;

const SOURCE_COLUMNS: Record<TimelineSource['kind'], string> = {
  referrer: 'referrerDomain',
  utmSource: 'utmSource',
  utmCampaign: 'utmCampaign',
};

/** Whether the session under `alias` came from the source, true without a source. */
export function fromSource(alias: string, source: TimelineSource | undefined): Prisma.Sql {
  if (!source) {
    return Prisma.sql`TRUE`;
  }
  const column = Prisma.raw(`${alias}."${SOURCE_COLUMNS[source.kind]}"`);
  return source.value === null
    ? Prisma.sql`${column} IS NULL`
    : Prisma.sql`lower(${column}) = lower(${source.value})`;
}

/** Whether a visitor's first session came from the source. */
function acquiredFrom(visitor: Prisma.Sql, source: TimelineSource | undefined): Prisma.Sql {
  if (!source) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.sql`EXISTS (
    SELECT 1 FROM (
      SELECT * FROM "AnalyticsSession" fs WHERE fs."visitorId" = ${visitor}
      ORDER BY fs."startedAt" LIMIT 1
    ) fs WHERE ${fromSource('fs', source)})`;
}

/** Whether an account is linked to a consenting browser whose first session came from the source. */
function accountFrom(account: Prisma.Sql, source: TimelineSource | undefined): Prisma.Sql {
  if (!source) {
    return Prisma.sql`TRUE`;
  }
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "AnalyticsVisitor" av
    WHERE av."userId" = ${account} AND ${acquiredFrom(Prisma.sql`av.id`, source)})`;
}

const forRelease = (column: Prisma.Sql, releaseId: number | undefined): Prisma.Sql =>
  releaseId === undefined ? Prisma.sql`TRUE` : Prisma.sql`${column} = ${releaseId}`;

const count = async (prisma: PrismaService, query: Prisma.Sql): Promise<SlotValue[]> =>
  prisma.$queryRaw<SlotValue[]>(query);

const fact =
  (type: string, withProject: boolean, withSource: boolean): Query =>
  (prisma, range, { releaseId, source }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`f."at"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsFact" f
        WHERE f."type" = ${type}::"AnalyticsFactType" AND ${within(Prisma.sql`f."at"`, range)}
          AND ${withProject ? forRelease(Prisma.sql`f."projectId"`, releaseId) : Prisma.sql`TRUE`}
          AND ${withSource ? accountFrom(Prisma.sql`f."actorUserId"`, source) : Prisma.sql`TRUE`}
        GROUP BY 1`,
    );

const anonymousPlays =
  (only: Prisma.Sql): Query =>
  (prisma, range, { releaseId }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`"minute"`, range)} AS slot, sum("playsStarted")::float8 AS value
        FROM "AnalyticsAnonTally"
        WHERE ${only} AND "releaseId" <> 0 AND "playsStarted" > 0
          AND ${within(Prisma.sql`"minute"`, range)}
          AND ${forRelease(Prisma.sql`"releaseId"`, releaseId)}
        GROUP BY 1`,
    );

const anonymousTabs =
  (consent: string): Query =>
  (prisma, range) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`"minute"`, range)} AS slot, max(beats)::float8 AS value
        FROM (
          SELECT "minute", sum("beats") AS beats FROM "AnalyticsAnonTally"
          WHERE "consent" = ${consent}::"AnalyticsAnonConsent" AND ${within(Prisma.sql`"minute"`, range)}
          GROUP BY "minute"
        ) AS minutes
        GROUP BY 1`,
    );

const presence =
  (column: string): Query =>
  (prisma, range) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`"at"`, range)} AS slot, max(${Prisma.raw(column)})::float8 AS value
        FROM "ConcurrencySample" WHERE ${within(Prisma.sql`"at"`, range)}
        GROUP BY 1`,
    );

export const TIMELINE_QUERIES: Record<TimelineMetric, Query> = {
  visitors_new: (prisma, range, { source }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`v."firstSeenAt"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsVisitor" v
        WHERE ${within(Prisma.sql`v."firstSeenAt"`, range)} AND ${acquiredFrom(Prisma.sql`v.id`, source)}
        GROUP BY 1`,
    ),

  sessions: (prisma, range, { source }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`s."startedAt"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsSession" s
        WHERE ${within(Prisma.sql`s."startedAt"`, range)} AND ${fromSource('s', source)}
        GROUP BY 1`,
    ),

  pageviews: (prisma, range, { source }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`pv."occurredAt"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsPageView" pv JOIN "AnalyticsSession" s ON s.id = pv."sessionId"
        WHERE ${within(Prisma.sql`pv."occurredAt"`, range)} AND ${fromSource('s', source)}
        GROUP BY 1`,
    ),

  plays_consented: (prisma, range, { releaseId, source }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`p."startedAt"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsPlay" p JOIN "AnalyticsSession" s ON s.id = p."sessionId"
        WHERE NOT p."continued" AND ${within(Prisma.sql`p."startedAt"`, range)}
          AND ${forRelease(Prisma.sql`p."releaseId"`, releaseId)} AND ${fromSource('s', source)}
        GROUP BY 1`,
    ),

  plays_anonymous: anonymousPlays(Prisma.sql`TRUE`),
  plays_declined: anonymousPlays(Prisma.sql`"consent" = 'DECLINED'`),
  plays_unanswered: anonymousPlays(Prisma.sql`"consent" = 'UNANSWERED'`),
  plays_anonymous_signed_in: anonymousPlays(Prisma.sql`"signedIn"`),

  players: (prisma, range, { releaseId, source }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`p."startedAt"`, range)} AS slot,
               count(DISTINCT s."visitorId")::float8 AS value
        FROM "AnalyticsPlay" p JOIN "AnalyticsSession" s ON s.id = p."sessionId"
        WHERE ${within(Prisma.sql`p."startedAt"`, range)}
          AND ${forRelease(Prisma.sql`p."releaseId"`, releaseId)} AND ${fromSource('s', source)}
        GROUP BY 1`,
    ),

  players_new: (prisma, range, { releaseId, source }) =>
    count(
      prisma,
      Prisma.sql`
        WITH firsts AS (
          SELECT s."visitorId", min(p."startedAt") AS at
          FROM "AnalyticsPlay" p JOIN "AnalyticsSession" s ON s.id = p."sessionId"
          WHERE ${forRelease(Prisma.sql`p."releaseId"`, releaseId)}
          GROUP BY s."visitorId"
          HAVING min(p."startedAt") >= ${range.from} AND min(p."startedAt") < ${range.to}
        )
        SELECT ${slotOf(Prisma.sql`f.at`, range)} AS slot, count(*)::float8 AS value
        FROM firsts f WHERE ${acquiredFrom(Prisma.sql`f."visitorId"`, source)}
        GROUP BY 1`,
    ),

  signups: fact('SIGNUP', false, true),

  signups_unlinked: (prisma, range) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`f."at"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsFact" f
        WHERE f."type" = 'SIGNUP' AND ${within(Prisma.sql`f."at"`, range)}
          AND NOT EXISTS (SELECT 1 FROM "AnalyticsVisitor" v WHERE v."userId" = f."actorUserId")
        GROUP BY 1`,
    ),

  projects_created: fact('PROJECT_CREATED', false, true),

  projects_forked: (prisma, range, { releaseId, source }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`f."at"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsFact" f JOIN "Project" p ON p.id = f."projectId"
        WHERE f."type" = 'PROJECT_CREATED' AND p."forked_from_id" IS NOT NULL
          AND ${within(Prisma.sql`f."at"`, range)}
          AND ${forRelease(Prisma.sql`p."forked_from_id"`, releaseId)}
          AND ${accountFrom(Prisma.sql`f."actorUserId"`, source)}
        GROUP BY 1`,
    ),
  releases_published: fact('RELEASE_PUBLISHED', true, true),
  releases_updated: fact('RELEASE_UPDATED', true, false),

  mp_sessions: (prisma, range, { releaseId }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`m."reachedMultiAt"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsMpSession" m
        WHERE NOT m."editorTest" AND ${within(Prisma.sql`m."reachedMultiAt"`, range)}
          AND ${forRelease(Prisma.sql`m."projectId"`, releaseId)}
        GROUP BY 1`,
    ),

  mp_participants: (prisma, range, { releaseId }) =>
    count(
      prisma,
      Prisma.sql`
        SELECT ${slotOf(Prisma.sql`seat."firstConnectedAt"`, range)} AS slot, count(*)::float8 AS value
        FROM "AnalyticsMpSeat" seat JOIN "AnalyticsMpSession" m ON m.id = seat."sessionId"
        WHERE NOT m."editorTest" AND ${within(Prisma.sql`seat."firstConnectedAt"`, range)}
          AND ${forRelease(Prisma.sql`m."projectId"`, releaseId)}
        GROUP BY 1`,
    ),

  active_browsers: presence('"activeBrowsers"'),
  browsers_playing: presence('"activeBrowsersPlaying"'),
  anon_tabs: presence('"anonTabs"'),
  anon_tabs_playing: presence('"anonTabsPlaying"'),
  anon_tabs_declined: anonymousTabs('DECLINED'),
  anon_tabs_unanswered: anonymousTabs('UNANSWERED'),
  accounts_online: presence('"accounts"'),
};
