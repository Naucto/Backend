import { BadRequestException, Injectable } from '@nestjs/common';
import { AnalyticsAnonConsent, AnalyticsFactType } from '@prisma/client';
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
  TIMELINE_METRIC_NAMES,
  TIMELINE_METRICS,
  TimelineFilter,
  TimelineMetric,
  TimelineSource,
  windowOf,
} from './analytics-timeline';
import {
  cameFrom,
  firstSessions,
  linkedVisitors,
  Sample,
  TIMELINE_READERS,
  TimelineFilters,
} from './analytics-timeline.readers';
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

const ACTIVITY_DEFAULTS = {
  visitorId: null,
  releaseId: null,
  referrer: null,
  utmSource: null,
  utmCampaign: null,
  country: null,
  device: null,
  count: 1,
  signedIn: null,
  consent: null,
} as const;

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
  releases: number[];
  linked: boolean;
  signedUpAt: Date | null;
  projectCreatedAt: Date | null;
  publishedAt: Date | null;
}

/** Each sample's value put in its bucket, combined the way the metric combines. */
export function bucketValues(
  samples: readonly Sample[],
  starts: readonly Date[],
  bucketMs: number,
  combine: 'sum' | 'distinct' | 'max',
): Map<number, number> {
  const first = starts[0]?.getTime() ?? 0;
  const sums = new Map<number, number>();
  const people = new Map<number, Set<string>>();
  for (const sample of samples) {
    const index = Math.floor((sample.at.getTime() - first) / bucketMs);
    if (index < 0 || index >= starts.length) {
      continue;
    }
    if (combine === 'distinct') {
      const seen = people.get(index) ?? new Set<string>();
      seen.add(sample.who ?? '');
      people.set(index, seen);
    } else if (combine === 'max') {
      sums.set(index, Math.max(sums.get(index) ?? Number.NEGATIVE_INFINITY, sample.value));
    } else {
      sums.set(index, (sums.get(index) ?? 0) + sample.value);
    }
  }
  if (combine === 'distinct') {
    return new Map([...people.entries()].map(([index, seen]) => [index, seen.size]));
  }
  return sums;
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
        const samples = await TIMELINE_READERS[metric](
          this.prisma,
          { from: window.from, to: window.to },
          this.applied(metric, filters),
        );
        const byBucket = bucketValues(samples, starts, window.bucketMs, definition.combine);
        const sampled = 'sampled' in definition;
        const values = starts.map((start, index) => {
          if (start.getTime() + window.bucketMs <= rawFrom.getTime() || start > now) {
            return null;
          }
          return byBucket.get(index) ?? (sampled ? null : 0);
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
          total: this.totalOf(metric, values, samples, rawFrom, now),
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
    const startedAt = { gte: from, lt: to };
    const [referrers, utmSources, utmCampaigns, newcomers] = await Promise.all([
      this.prisma.analyticsSession.groupBy({
        by: ['referrerDomain'],
        where: { startedAt },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: SOURCES_PER_KIND,
      }),
      this.prisma.analyticsSession.groupBy({
        by: ['utmSource'],
        where: { startedAt, utmSource: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: SOURCES_PER_KIND,
      }),
      this.prisma.analyticsSession.groupBy({
        by: ['utmCampaign'],
        where: { startedAt, utmCampaign: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } },
        take: SOURCES_PER_KIND,
      }),
      this.prisma.analyticsVisitor.findMany({
        where: { firstSeenAt: startedAt },
        select: { id: true },
      }),
    ]);
    const firsts = [
      ...(
        await firstSessions(
          this.prisma,
          newcomers.map((visitor) => visitor.id),
        )
      ).values(),
    ];
    const rows = [
      ...referrers.map((row) => ({
        kind: 'referrer' as const,
        value: row.referrerDomain,
        count: row._count._all,
      })),
      ...utmSources.map((row) => ({
        kind: 'utmSource' as const,
        value: row.utmSource,
        count: row._count._all,
      })),
      ...utmCampaigns.map((row) => ({
        kind: 'utmCampaign' as const,
        value: row.utmCampaign,
        count: row._count._all,
      })),
    ];
    return {
      sources: rows
        .sort((a, b) => b.count - a.count)
        .map((row) => ({
          source: `${row.kind}:${row.value ?? NO_SOURCE_VALUE}`,
          kind: row.kind,
          value: row.value,
          sessions: row.count,
          visitorsNew: firsts.filter((first) =>
            cameFrom(first, { kind: row.kind, value: row.value }),
          ).length,
        })),
    };
  }

  async activity(query: AnalyticsActivityQueryDto): Promise<AnalyticsActivityDto> {
    const { from, to } = this.instants(query);
    const limit = query.limit ?? DEFAULT_LIMIT;
    const within = { gte: from, lt: to };
    const [visitors, plays, facts, rooms, anonymous] = await Promise.all([
      this.prisma.analyticsVisitor.findMany({
        where: { firstSeenAt: within },
        orderBy: { firstSeenAt: 'desc' },
        take: limit + 1,
        select: { id: true, firstSeenAt: true },
      }),
      this.prisma.analyticsPlay.findMany({
        where: { startedAt: within },
        orderBy: { startedAt: 'asc' },
        select: { startedAt: true, releaseId: true, session: { select: { visitorId: true } } },
      }),
      this.prisma.analyticsFact.findMany({
        where: { at: within, type: { not: 'RELEASE_UPDATED' } },
        orderBy: { at: 'desc' },
        take: limit + 1,
        select: { at: true, type: true, actorUserId: true, projectId: true },
      }),
      this.prisma.analyticsMpSession.findMany({
        where: { editorTest: false, reachedMultiAt: within },
        orderBy: { reachedMultiAt: 'desc' },
        take: limit + 1,
        select: { reachedMultiAt: true, projectId: true, peakConnected: true },
      }),
      this.prisma.analyticsAnonTally.groupBy({
        by: ['minute', 'releaseId', 'signedIn', 'consent'],
        where: { minute: within, playsStarted: { gt: 0 }, releaseId: { not: 0 } },
        _sum: { playsStarted: true },
        orderBy: { minute: 'desc' },
        take: limit + 1,
      }),
    ]);

    const firstOfVisitor = new Map<string, { at: Date; releaseId: number }>();
    for (const play of plays) {
      if (!firstOfVisitor.has(play.session.visitorId)) {
        firstOfVisitor.set(play.session.visitorId, {
          at: play.startedAt,
          releaseId: play.releaseId,
        });
      }
    }
    const playedBefore = new Set(
      (
        await this.prisma.analyticsPlay.findMany({
          where: {
            startedAt: { lt: from },
            session: { visitorId: { in: [...firstOfVisitor.keys()] } },
          },
          distinct: ['sessionId'],
          select: { session: { select: { visitorId: true } } },
        })
      ).map((play) => play.session.visitorId),
    );
    const firstSessionOf = await firstSessions(
      this.prisma,
      visitors.map((visitor) => visitor.id),
    );
    const linked = new Map<number, string>();
    for (const visitor of await linkedVisitors(
      this.prisma,
      facts.flatMap((one) => (one.actorUserId === null ? [] : [one.actorUserId])),
    )) {
      if (!linked.has(visitor.userId)) {
        linked.set(visitor.userId, visitor.id);
      }
    }

    const rows: ActivityRow[] = [
      ...visitors.map((visitor): ActivityRow => {
        const first = firstSessionOf.get(visitor.id);
        return {
          ...ACTIVITY_DEFAULTS,
          at: visitor.firstSeenAt,
          kind: 'FIRST_VISIT',
          visitorId: visitor.id,
          referrer: first?.referrerDomain ?? null,
          utmSource: first?.utmSource ?? null,
          utmCampaign: first?.utmCampaign ?? null,
          country: first?.country ?? null,
          device: first?.device ?? null,
        };
      }),
      ...[...firstOfVisitor.entries()]
        .filter(([visitorId]) => !playedBefore.has(visitorId))
        .map(
          ([visitorId, play]): ActivityRow => ({
            ...ACTIVITY_DEFAULTS,
            at: play.at,
            kind: 'FIRST_PLAY',
            visitorId,
            releaseId: play.releaseId,
          }),
        ),
      ...facts.map(
        (one): ActivityRow => ({
          ...ACTIVITY_DEFAULTS,
          at: one.at,
          kind: one.type as Exclude<AnalyticsFactType, 'RELEASE_UPDATED'>,
          visitorId: one.actorUserId === null ? null : (linked.get(one.actorUserId) ?? null),
          releaseId: one.projectId,
        }),
      ),
      ...rooms.flatMap((room): ActivityRow[] =>
        room.reachedMultiAt
          ? [
              {
                ...ACTIVITY_DEFAULTS,
                at: room.reachedMultiAt,
                kind: 'MP_SESSION',
                releaseId: room.projectId,
                count: room.peakConnected,
              },
            ]
          : [],
      ),
      ...anonymous.map(
        (row): ActivityRow => ({
          ...ACTIVITY_DEFAULTS,
          at: row.minute,
          kind: 'ANONYMOUS_PLAYS',
          releaseId: row.releaseId,
          count: row._sum.playsStarted ?? 0,
          signedIn: row.signedIn,
          consent: row.consent,
        }),
      ),
    ].sort((a, b) => b.at.getTime() - a.at.getTime() || a.kind.localeCompare(b.kind));
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
    const within = { gte: from, lt: to };

    const population = await this.prisma.analyticsVisitor.findMany({
      where: { firstSeenAt: within },
      orderBy: { firstSeenAt: 'desc' },
      select: { id: true, firstSeenAt: true, lastSeenAt: true, userId: true },
    });
    const firstSessionOf = await firstSessions(
      this.prisma,
      population.map((visitor) => visitor.id),
    );
    const arrived = population.filter((visitor) => {
      const first = firstSessionOf.get(visitor.id);
      return !source || (first !== undefined && cameFrom(first, source));
    });
    const ids = arrived.map((visitor) => visitor.id);
    const accounts = arrived.flatMap((visitor) =>
      visitor.userId === null ? [] : [visitor.userId],
    );

    const [sessionCounts, plays, facts, anonymousByAnswer, anonymousByGame, unlinked] =
      await Promise.all([
        this.prisma.analyticsSession.groupBy({
          by: ['visitorId'],
          where: { visitorId: { in: ids } },
          _count: { _all: true },
        }),
        this.prisma.analyticsPlay.findMany({
          where: { session: { visitorId: { in: ids } } },
          orderBy: { startedAt: 'asc' },
          select: {
            startedAt: true,
            releaseId: true,
            continued: true,
            session: { select: { visitorId: true } },
          },
        }),
        this.prisma.analyticsFact.findMany({
          where: {
            actorUserId: { in: accounts },
            type: { in: ['SIGNUP', 'PROJECT_CREATED', 'RELEASE_PUBLISHED'] },
          },
          orderBy: { at: 'asc' },
          select: { at: true, type: true, actorUserId: true },
        }),
        this.prisma.analyticsAnonTally.groupBy({
          by: ['consent', 'signedIn'],
          where: { minute: within, releaseId: { not: 0 } },
          _sum: { playsStarted: true },
        }),
        this.prisma.analyticsAnonTally.groupBy({
          by: ['releaseId'],
          where: { minute: within, releaseId: { not: 0 }, playsStarted: { gt: 0 } },
          _sum: { playsStarted: true },
        }),
        TIMELINE_READERS.signups_unlinked(this.prisma, { from, to }, {}),
      ]);

    const sessionsOf = new Map(sessionCounts.map((row) => [row.visitorId, row._count._all]));
    const playsOf = new Map<string, typeof plays>();
    for (const play of plays) {
      playsOf.set(play.session.visitorId, [...(playsOf.get(play.session.visitorId) ?? []), play]);
    }
    const factsOf = new Map<number, typeof facts>();
    for (const one of facts) {
      if (one.actorUserId !== null) {
        factsOf.set(one.actorUserId, [...(factsOf.get(one.actorUserId) ?? []), one]);
      }
    }
    const rows: ArrivalRow[] = arrived.map((visitor) => {
      const first = firstSessionOf.get(visitor.id);
      const played = playsOf.get(visitor.id) ?? [];
      const counted = played.filter((play) => !play.continued);
      const own = visitor.userId === null ? [] : (factsOf.get(visitor.userId) ?? []);
      const firstOf = (type: AnalyticsFactType, since: Date | null): Date | null =>
        own.find((one) => one.type === type && (since === null || one.at >= since))?.at ?? null;
      return {
        visitorId: visitor.id,
        firstSeenAt: visitor.firstSeenAt,
        lastSeenAt: visitor.lastSeenAt,
        referrer: first?.referrerDomain ?? null,
        utmSource: first?.utmSource ?? null,
        utmCampaign: first?.utmCampaign ?? null,
        country: first?.country ?? null,
        device: first?.device ?? null,
        sessions: sessionsOf.get(visitor.id) ?? 0,
        plays: counted.length,
        firstPlayAt: played[0]?.startedAt ?? null,
        releases: counted.map((play) => play.releaseId),
        linked: visitor.userId !== null,
        signedUpAt: firstOf('SIGNUP', null),
        projectCreatedAt: firstOf('PROJECT_CREATED', visitor.firstSeenAt),
        publishedAt: firstOf('RELEASE_PUBLISHED', visitor.firstSeenAt),
      };
    });
    const playsWhere = (keep: (row: (typeof anonymousByAnswer)[number]) => boolean): number =>
      anonymousByAnswer.filter(keep).reduce((sum, row) => sum + (row._sum.playsStarted ?? 0), 0);
    const anonymous = {
      all: playsWhere(() => true),
      declined: playsWhere((row) => row.consent === 'DECLINED'),
      unanswered: playsWhere((row) => row.consent === 'UNANSWERED'),
      signedIn: playsWhere((row) => row.signedIn),
      unlinkedSignups: unlinked.length,
    };

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
      const releases = row.releases;
      for (const releaseId of new Set(releases)) {
        gameOf(releaseId).players += 1;
      }
      for (const releaseId of releases) {
        gameOf(releaseId).plays += 1;
      }
    }
    for (const row of anonymousByGame) {
      gameOf(row.releaseId).anonymousPlays = row._sum.playsStarted ?? 0;
    }
    const topGames = [...games.entries()]
      .sort((a, b) => b[1].plays + b[1].anonymousPlays - (a[1].plays + a[1].anonymousPlays))
      .slice(0, ARRIVAL_GAMES);
    const listed = rows.slice(0, limit);
    const names = await this.namesOf([
      ...topGames.map(([releaseId]) => releaseId),
      ...listed.flatMap((row) => row.releases),
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
        games: this.mostPlayed(row.releases, names),
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

  private totalOf(
    metric: TimelineMetric,
    values: (number | null)[],
    samples: readonly Sample[],
    rawFrom: Date,
    now: Date,
  ): number | null {
    const known = values.filter((value): value is number => value !== null);
    if (known.length === 0) {
      return null;
    }
    switch (TIMELINE_METRICS[metric].combine) {
      case 'sum':
        return known.reduce((sum, value) => sum + value, 0);
      case 'max':
        return Math.max(...known);
      case 'distinct':
        return new Set(
          samples
            .filter((sample) => sample.at >= rawFrom && sample.at <= now)
            .map((sample) => sample.who ?? ''),
        ).size;
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
