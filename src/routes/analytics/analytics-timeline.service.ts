import { BadRequestException, Injectable } from '@nestjs/common';
import { AnalyticsAnonConsent } from '@prisma/client';
import { createHmac, randomBytes } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { RAW_RETENTION_DAYS } from './analytics-purge.service';
import { DAY_MS } from './analytics-time';
import {
  bucketFor,
  bucketStarts,
  MAX_TIMELINE_BUCKETS,
  NO_SOURCE_VALUE,
  parseSource,
  SOURCE_KINDS,
  TIMELINE_METRIC_NAMES,
  TIMELINE_METRICS,
  TimelineFilter,
  TimelineMetric,
  TimelineSource,
  windowOf,
} from './analytics-timeline';
import {
  fromSource,
  SlotValue,
  TIMELINE_QUERIES,
  TimelineFilters,
} from './analytics-timeline.queries';
import {
  AnalyticsActivityQueryDto,
  AnalyticsArrivalsQueryDto,
  AnalyticsInstantRangeQueryDto,
  AnalyticsReleasesQueryDto,
  AnalyticsTimelineQueryDto,
} from './dto/admin-timeline-query.dto';
import {
  ActivityKind,
  AnalyticsActivityDto,
  AnalyticsActivityItemDto,
  AnalyticsArrivalsDto,
  AnalyticsReleasesDto,
  AnalyticsSourcesDto,
  AnalyticsTimelineDto,
  AnalyticsTimelineSeriesDto,
} from './dto/admin-timeline-response.dto';

const MAX_SPAN_MS = (RAW_RETENTION_DAYS + 1) * DAY_MS;
const DEFAULT_LIMIT = 200;
const SOURCES_PER_KIND = 30;
const ARRIVAL_GAMES = 10;

interface Instants {
  from: Date;
  to: Date;
}

interface ActivityRow {
  at: Date;
  kind: ActivityKind;
  visitorId: string | null;
  releaseId: number | null;
  referrer: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  country: string | null;
  device: string | null;
  count: number;
  signedIn: boolean | null;
  consent: AnalyticsAnonConsent | null;
}

interface ArrivalRow {
  visitorId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  referrer: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  country: string | null;
  device: string | null;
  sessions: number;
  plays: number;
  firstPlayAt: Date | null;
  releases: number[] | null;
  linked: boolean;
  signedUpAt: Date | null;
  projectCreatedAt: Date | null;
  publishedAt: Date | null;
}

/** The source a session's columns stand for, preferring the campaign over its referrer. */
export function sourceOf(row: {
  referrer: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
}): string {
  if (row.utmCampaign) {
    return `utmCampaign:${row.utmCampaign}`;
  }
  if (row.utmSource) {
    return `utmSource:${row.utmSource}`;
  }
  return `referrer:${row.referrer ?? NO_SOURCE_VALUE}`;
}

/**
 * Answers the admin panel's timeline: raw analytics between two instants, in buckets of a minute
 * to a day, narrowed to a game or a source, with what happened in the window one event at a time.
 */
@Injectable()
export class AnalyticsTimelineService {
  /** Keys the journey codes, so a code is stable while the backend runs and reveals no cookie. */
  private readonly journeyKey = randomBytes(32);

  constructor(private readonly prisma: PrismaService) {}

  async timeline(
    query: AnalyticsTimelineQueryDto,
    now = new Date(),
  ): Promise<AnalyticsTimelineDto> {
    const { from, to } = this.instants(query);
    const bucket = query.bucket ?? bucketFor(to.getTime() - from.getTime());
    const window = windowOf(from, to, bucket);
    const starts = bucketStarts(window);
    if (starts.length > MAX_TIMELINE_BUCKETS) {
      throw new BadRequestException(
        `At most ${String(MAX_TIMELINE_BUCKETS)} buckets; choose a larger bucket`,
      );
    }
    const filters = this.filtersOf(query);
    const given: TimelineFilter[] = [
      ...(filters.releaseId === undefined ? [] : (['release'] as const)),
      ...(filters.source === undefined ? [] : (['source'] as const)),
    ];
    const rawFrom = this.rawFrom(now);
    const metrics = query.metrics?.length ? query.metrics : TIMELINE_METRIC_NAMES;

    const series = await Promise.all(
      metrics.map(async (metric): Promise<AnalyticsTimelineSeriesDto> => {
        const definition = TIMELINE_METRICS[metric];
        const applied = this.applied(metric, filters);
        const rows = await TIMELINE_QUERIES[metric](
          this.prisma,
          { from: window.from, to: window.to, slotMs: window.bucketMs },
          applied,
        );
        const bySlot = new Map(rows.map((row) => [row.slot, row.value]));
        const sampled = 'sampled' in definition;
        const values = starts.map((start) => {
          if (start.getTime() + window.bucketMs <= rawFrom.getTime() || start > now) {
            return null;
          }
          const value = bySlot.get(start.getTime() / window.bucketMs);
          return value ?? (sampled ? null : 0);
        });
        return {
          metric,
          population: definition.population,
          combine: definition.combine,
          definition: definition.definition,
          ignoredFilters: given.filter(
            (filter) => !(definition.filters as readonly TimelineFilter[]).includes(filter),
          ),
          values,
          total: await this.totalOf(metric, values, window, rawFrom, now, applied),
        };
      }),
    );

    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      bucket,
      bucketMs: window.bucketMs,
      rawFrom: rawFrom.toISOString(),
      buckets: starts.map((start) => start.toISOString()),
      series,
    };
  }

  async sources(query: AnalyticsInstantRangeQueryDto): Promise<AnalyticsSourcesDto> {
    const { from, to } = this.instants(query);
    const rows = await this.prisma.$queryRaw<
      { kind: string; value: string | null; sessions: number; visitorsNew: number }[]
    >`
      WITH ranked AS (
        SELECT s.*, row_number() OVER (PARTITION BY s."visitorId" ORDER BY s."startedAt") AS nth
        FROM "AnalyticsSession" s
        WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to}
      ),
      firsts AS (
        SELECT r.* FROM ranked r JOIN "AnalyticsVisitor" v ON v.id = r."visitorId"
        WHERE r.nth = 1 AND v."firstSeenAt" >= ${from} AND v."firstSeenAt" < ${to}
      ),
      counted AS (
        SELECT 'referrer' AS kind, "referrerDomain" AS value, count(*)::int AS sessions,
               (SELECT count(*) FROM firsts f WHERE f."referrerDomain" IS NOT DISTINCT FROM r."referrerDomain")::int AS "visitorsNew"
        FROM ranked r GROUP BY "referrerDomain"
        UNION ALL
        SELECT 'utmSource', "utmSource", count(*)::int,
               (SELECT count(*) FROM firsts f WHERE f."utmSource" = r."utmSource")::int
        FROM ranked r WHERE "utmSource" IS NOT NULL GROUP BY "utmSource"
        UNION ALL
        SELECT 'utmCampaign', "utmCampaign", count(*)::int,
               (SELECT count(*) FROM firsts f WHERE f."utmCampaign" = r."utmCampaign")::int
        FROM ranked r WHERE "utmCampaign" IS NOT NULL GROUP BY "utmCampaign"
      )
      SELECT * FROM (
        SELECT *, row_number() OVER (PARTITION BY kind ORDER BY sessions DESC) AS rank FROM counted
      ) ranked_sources WHERE rank <= ${SOURCES_PER_KIND}
      ORDER BY sessions DESC`;
    return {
      sources: rows
        .filter((row) => (SOURCE_KINDS as readonly string[]).includes(row.kind))
        .map((row) => ({
          source: `${row.kind}:${row.value ?? NO_SOURCE_VALUE}`,
          kind: row.kind,
          value: row.value,
          sessions: row.sessions,
          visitorsNew: row.visitorsNew,
        })),
    };
  }

  async activity(query: AnalyticsActivityQueryDto): Promise<AnalyticsActivityDto> {
    const { from, to } = this.instants(query);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.$queryRaw<ActivityRow[]>`
      WITH linked AS (
        SELECT DISTINCT ON ("userId") "userId", id FROM "AnalyticsVisitor"
        WHERE "userId" IS NOT NULL ORDER BY "userId", "firstSeenAt"
      ),
      events AS (
        SELECT v."firstSeenAt" AS at, 'FIRST_VISIT' AS kind, v.id AS "visitorId", NULL::int AS "releaseId",
               fs."referrerDomain" AS referrer, fs."utmSource", fs."utmCampaign", fs.country, fs.device,
               1 AS count, NULL::boolean AS "signedIn", NULL::"AnalyticsAnonConsent" AS consent
        FROM "AnalyticsVisitor" v
        LEFT JOIN LATERAL (
          SELECT * FROM "AnalyticsSession" s WHERE s."visitorId" = v.id ORDER BY s."startedAt" LIMIT 1
        ) fs ON TRUE
        WHERE v."firstSeenAt" >= ${from} AND v."firstSeenAt" < ${to}
        UNION ALL
        SELECT firsts.at, 'FIRST_PLAY', firsts."visitorId", firsts."releaseId",
               NULL, NULL, NULL, NULL, NULL, 1, NULL, NULL
        FROM (
          SELECT DISTINCT ON (s."visitorId") s."visitorId", p."startedAt" AS at, p."releaseId"
          FROM "AnalyticsPlay" p JOIN "AnalyticsSession" s ON s.id = p."sessionId"
          ORDER BY s."visitorId", p."startedAt"
        ) firsts
        WHERE firsts.at >= ${from} AND firsts.at < ${to}
        UNION ALL
        SELECT f."at", f."type"::text, linked.id, f."projectId", NULL, NULL, NULL, NULL, NULL, 1, NULL,
               NULL
        FROM "AnalyticsFact" f LEFT JOIN linked ON linked."userId" = f."actorUserId"
        WHERE f."type" <> 'RELEASE_UPDATED' AND f."at" >= ${from} AND f."at" < ${to}
        UNION ALL
        SELECT m."reachedMultiAt", 'MP_SESSION', NULL, m."projectId", NULL, NULL, NULL, NULL, NULL,
               m."peakConnected", NULL, NULL
        FROM "AnalyticsMpSession" m
        WHERE NOT m."editorTest" AND m."reachedMultiAt" >= ${from} AND m."reachedMultiAt" < ${to}
        UNION ALL
        SELECT t."minute", 'ANONYMOUS_PLAYS', NULL, t."releaseId", NULL, NULL, NULL, NULL, NULL,
               sum(t."playsStarted")::int, t."signedIn", t."consent"
        FROM "AnalyticsAnonTally" t
        WHERE t."playsStarted" > 0 AND t."releaseId" <> 0
          AND t."minute" >= ${from} AND t."minute" < ${to}
        GROUP BY t."minute", t."releaseId", t."signedIn", t."consent"
      )
      SELECT * FROM events ORDER BY at DESC, kind LIMIT ${limit + 1}`;
    const kept = rows.slice(0, limit);
    const names = await this.namesOf(kept.map((row) => row.releaseId));
    return {
      items: kept.map(
        (row): AnalyticsActivityItemDto => ({
          at: row.at.toISOString(),
          kind: row.kind,
          journey: row.visitorId === null ? null : this.journeyOf(row.visitorId),
          releaseId: row.releaseId,
          game: row.releaseId === null ? null : (names.get(row.releaseId) ?? null),
          source: row.kind === 'FIRST_VISIT' ? sourceOf(row) : null,
          country: row.country,
          device: row.device,
          count: row.count,
          signedIn: row.signedIn,
          consent: row.consent,
        }),
      ),
      truncated: rows.length > limit,
    };
  }

  async arrivals(query: AnalyticsArrivalsQueryDto): Promise<AnalyticsArrivalsDto> {
    const { from, to } = this.instants(query);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const source = query.source === undefined ? undefined : this.sourceOf(query.source);
    const rows = await this.prisma.$queryRaw<ArrivalRow[]>`
      WITH population AS (
        SELECT v.id, v."firstSeenAt", v."lastSeenAt", v."userId", fs."referrerDomain", fs."utmSource",
               fs."utmCampaign", fs.country, fs.device
        FROM "AnalyticsVisitor" v
        LEFT JOIN LATERAL (
          SELECT * FROM "AnalyticsSession" s WHERE s."visitorId" = v.id ORDER BY s."startedAt" LIMIT 1
        ) fs ON TRUE
        WHERE v."firstSeenAt" >= ${from} AND v."firstSeenAt" < ${to} AND ${fromSource('fs', source)}
      )
      SELECT pop.id AS "visitorId", pop."firstSeenAt", pop."lastSeenAt",
             pop."referrerDomain" AS referrer, pop."utmSource", pop."utmCampaign", pop.country, pop.device,
             (SELECT count(*) FROM "AnalyticsSession" s WHERE s."visitorId" = pop.id)::int AS sessions,
             COALESCE(played.plays, 0)::int AS plays, played."firstPlayAt", played.releases,
             pop."userId" IS NOT NULL AS linked,
             (SELECT min(f."at") FROM "AnalyticsFact" f
               WHERE f."type" = 'SIGNUP' AND f."actorUserId" = pop."userId") AS "signedUpAt",
             (SELECT min(f."at") FROM "AnalyticsFact" f
               WHERE f."type" = 'PROJECT_CREATED' AND f."actorUserId" = pop."userId"
                 AND f."at" >= pop."firstSeenAt") AS "projectCreatedAt",
             (SELECT min(f."at") FROM "AnalyticsFact" f
               WHERE f."type" = 'RELEASE_PUBLISHED' AND f."actorUserId" = pop."userId"
                 AND f."at" >= pop."firstSeenAt") AS "publishedAt"
      FROM population pop
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE NOT p."continued") AS plays, min(p."startedAt") AS "firstPlayAt",
               array_agg(p."releaseId" ORDER BY p."startedAt") FILTER (WHERE NOT p."continued") AS releases
        FROM "AnalyticsPlay" p JOIN "AnalyticsSession" s ON s.id = p."sessionId"
        WHERE s."visitorId" = pop.id
      ) played ON TRUE
      ORDER BY pop."firstSeenAt" DESC`;

    const [anonymous] = await this.prisma.$queryRaw<
      [
        {
          all: number;
          declined: number;
          unanswered: number;
          signedIn: number;
          unlinkedSignups: number;
        },
      ]
    >`
      SELECT COALESCE(sum("playsStarted"), 0)::int AS "all",
             COALESCE(sum("playsStarted") FILTER (WHERE "consent" = 'DECLINED'), 0)::int AS declined,
             COALESCE(sum("playsStarted") FILTER (WHERE "consent" = 'UNANSWERED'), 0)::int AS unanswered,
             COALESCE(sum("playsStarted") FILTER (WHERE "signedIn"), 0)::int AS "signedIn",
             (SELECT count(*) FROM "AnalyticsFact" f
               WHERE f."type" = 'SIGNUP' AND f."at" >= ${from} AND f."at" < ${to}
                 AND NOT EXISTS (SELECT 1 FROM "AnalyticsVisitor" v WHERE v."userId" = f."actorUserId")
             )::int AS "unlinkedSignups"
      FROM "AnalyticsAnonTally"
      WHERE "releaseId" <> 0 AND "minute" >= ${from} AND "minute" < ${to}`;
    const anonymousByGame = await this.prisma.$queryRaw<{ releaseId: number; plays: number }[]>`
      SELECT "releaseId", sum("playsStarted")::int AS plays FROM "AnalyticsAnonTally"
      WHERE "releaseId" <> 0 AND "playsStarted" > 0 AND "minute" >= ${from} AND "minute" < ${to}
      GROUP BY "releaseId"`;

    const isNew = (row: ArrivalRow): boolean =>
      row.signedUpAt !== null && row.signedUpAt >= row.firstSeenAt;
    const games = new Map<number, { players: number; plays: number; anonymousPlays: number }>();
    const gameOf = (
      releaseId: number,
    ): { players: number; plays: number; anonymousPlays: number } => {
      const game = games.get(releaseId) ?? { players: 0, plays: 0, anonymousPlays: 0 };
      games.set(releaseId, game);
      return game;
    };
    for (const row of rows) {
      const releases = row.releases ?? [];
      for (const releaseId of new Set(releases)) {
        gameOf(releaseId).players += 1;
      }
      for (const releaseId of releases) {
        gameOf(releaseId).plays += 1;
      }
    }
    for (const row of anonymousByGame) {
      gameOf(row.releaseId).anonymousPlays = row.plays;
    }
    const topGames = [...games.entries()]
      .sort((a, b) => b[1].plays + b[1].anonymousPlays - (a[1].plays + a[1].anonymousPlays))
      .slice(0, ARRIVAL_GAMES);
    const listed = rows.slice(0, limit);
    const names = await this.namesOf([
      ...topGames.map(([releaseId]) => releaseId),
      ...listed.flatMap((row) => row.releases ?? []),
    ]);

    return {
      summary: {
        arrived: rows.length,
        played: rows.filter((row) => row.firstPlayAt !== null).length,
        signedUp: rows.filter(isNew).length,
        existingAccounts: rows.filter((row) => row.linked && !isNew(row)).length,
        createdProject: rows.filter((row) => row.projectCreatedAt !== null).length,
        published: rows.filter((row) => row.publishedAt !== null).length,
        anonymousPlays: anonymous.all,
        declinedPlays: anonymous.declined,
        unansweredPlays: anonymous.unanswered,
        anonymousSignedInPlays: anonymous.signedIn,
        unlinkedSignups: anonymous.unlinkedSignups,
      },
      games: topGames.map(([releaseId, game]) => ({
        releaseId,
        name: names.get(releaseId) ?? null,
        ...game,
      })),
      visitors: listed.map((row) => ({
        journey: this.journeyOf(row.visitorId),
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        referrer: row.referrer,
        utmSource: row.utmSource,
        utmCampaign: row.utmCampaign,
        country: row.country,
        device: row.device,
        sessions: row.sessions,
        plays: row.plays,
        firstPlayAt: row.firstPlayAt?.toISOString() ?? null,
        games: this.mostPlayed(row.releases ?? [], names),
        account: row.linked ? (isNew(row) ? 'NEW' : 'EXISTING') : null,
        signedUpAt: isNew(row) ? (row.signedUpAt?.toISOString() ?? null) : null,
        projectCreatedAt: row.projectCreatedAt?.toISOString() ?? null,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      })),
    };
  }

  /**
   * Published games matching part of a name or an id, or the projects of the given ids whatever
   * their state, so a picker never has to hold every game there is.
   */
  async releases(query: AnalyticsReleasesQueryDto): Promise<AnalyticsReleasesDto> {
    const select = { id: true, name: true, publishedName: true, publishedAt: true } as const;
    const limit = query.limit ?? 10;
    let projects;
    if (query.ids?.length) {
      projects = await this.prisma.project.findMany({
        where: { id: { in: query.ids } },
        select,
        take: 50,
      });
    } else {
      const text = query.query?.trim() ?? '';
      const asId = /^#?(\d{1,9})$/.exec(text)?.[1];
      projects = await this.prisma.project.findMany({
        where: {
          publishedAt: { not: null },
          ...(text === ''
            ? {}
            : {
                OR: [
                  { publishedName: { contains: text, mode: 'insensitive' } },
                  { name: { contains: text, mode: 'insensitive' } },
                  ...(asId === undefined ? [] : [{ id: Number(asId) }]),
                ],
              }),
        },
        select,
        orderBy: { publishedAt: 'desc' },
        take: limit,
      });
      if (asId !== undefined) {
        const exact = projects.findIndex((project) => project.id === Number(asId));
        if (exact > 0) {
          projects.unshift(...projects.splice(exact, 1));
        }
      }
    }
    return {
      releases: projects.map((project) => ({
        releaseId: project.id,
        name: project.publishedName ?? project.name,
        publishedAt: project.publishedAt?.toISOString() ?? null,
      })),
    };
  }

  /** A short code for a consenting browser, keyed so that it cannot be turned back into it. */
  journeyOf(visitorId: string): string {
    return createHmac('sha256', this.journeyKey).update(visitorId).digest('hex').slice(0, 6);
  }

  private async totalOf(
    metric: TimelineMetric,
    values: (number | null)[],
    window: { from: Date; to: Date },
    rawFrom: Date,
    now: Date,
    filters: TimelineFilters,
  ): Promise<number | null> {
    const known = values.filter((value): value is number => value !== null);
    if (known.length === 0) {
      return null;
    }
    switch (TIMELINE_METRICS[metric].combine) {
      case 'sum':
        return known.reduce((sum, value) => sum + value, 0);
      case 'max':
        return Math.max(...known);
      case 'distinct': {
        const from = new Date(Math.max(window.from.getTime(), rawFrom.getTime()));
        const to = new Date(Math.min(window.to.getTime(), now.getTime()));
        const rows: SlotValue[] = await TIMELINE_QUERIES[metric](
          this.prisma,
          { from, to, slotMs: null },
          filters,
        );
        return rows[0]?.value ?? 0;
      }
    }
  }

  private applied(metric: TimelineMetric, filters: TimelineFilters): TimelineFilters {
    const supported = TIMELINE_METRICS[metric].filters as readonly TimelineFilter[];
    return {
      ...(supported.includes('release') && filters.releaseId !== undefined
        ? { releaseId: filters.releaseId }
        : {}),
      ...(supported.includes('source') && filters.source !== undefined
        ? { source: filters.source }
        : {}),
    };
  }

  private filtersOf(query: AnalyticsTimelineQueryDto): TimelineFilters {
    return {
      ...(query.releaseId === undefined ? {} : { releaseId: query.releaseId }),
      ...(query.source === undefined ? {} : { source: this.sourceOf(query.source) }),
    };
  }

  private sourceOf(raw: string): TimelineSource {
    const source = parseSource(raw);
    if (!source) {
      throw new BadRequestException(
        'A source reads `referrer:<domain>`, `utmSource:<value>` or `utmCampaign:<value>`',
      );
    }
    return source;
  }

  private instants(query: AnalyticsInstantRangeQueryDto): Instants {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new BadRequestException('from and to must be instants, from first');
    }
    if (to.getTime() - from.getTime() > MAX_SPAN_MS) {
      throw new BadRequestException(
        `A window spans at most ${String(RAW_RETENTION_DAYS)} days, the raw data kept`,
      );
    }
    return { from, to };
  }

  /** Raw data older than the retention may already be purged: its buckets have no value. */
  private rawFrom(now: Date): Date {
    const cutoff = now.getTime() - RAW_RETENTION_DAYS * DAY_MS;
    return new Date(Math.floor(cutoff / DAY_MS) * DAY_MS);
  }

  private mostPlayed(releases: number[], names: Map<number, string>): string[] {
    const counts = new Map<number, number>();
    for (const releaseId of releases) {
      counts.set(releaseId, (counts.get(releaseId) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([releaseId]) => names.get(releaseId) ?? `#${String(releaseId)}`);
  }

  private async namesOf(releaseIds: (number | null)[]): Promise<Map<number, string>> {
    const ids = [...new Set(releaseIds.filter((id): id is number => id !== null))];
    if (ids.length === 0) {
      return new Map();
    }
    const projects = await this.prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, publishedName: true },
    });
    return new Map(projects.map((project) => [project.id, project.publishedName ?? project.name]));
  }
}
