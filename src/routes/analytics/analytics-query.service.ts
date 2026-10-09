import { BadRequestException, Injectable } from '@nestjs/common';
import { AnalyticsGrain, AnalyticsLiveState, AnalyticsRetentionKind } from '@prisma/client';

import { PresenceService } from '../../presence/presence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { metricsOf, truncateDimensions } from './analytics-finalize.service';
import {
  ERASURE_CONTRACT,
  METRIC_NAMES,
  MetricName,
  METRICS,
  OTHER_DIMENSION_VALUE,
  RETENTION_OFFSETS,
  RETENTION_VERSION,
  TRUNCATED_DIMENSIONS,
} from './analytics-metrics';
import { Period, periodOf, ROLLUP_CLASSES, RollupClass } from './analytics-periods';
import { RAW_RETENTION_DAYS } from './analytics-purge.service';
import {
  activityMetrics,
  DayRange,
  earliestRawDay,
  factMetrics,
  ingestErrorRate,
  MetricValue,
  multiplayerMetrics,
  presenceMetrics,
  samplerCoverage,
  sessionMetrics,
} from './analytics-rollup.queries';
import { DAY_MS, MINUTE_MS, minuteStart, utcDay } from './analytics-time';
import {
  AnalyticsBreakdownQueryDto,
  AnalyticsGamesQueryDto,
  AnalyticsPeriodQueryDto,
  AnalyticsPresenceQueryDto,
  AnalyticsRangeQueryDto,
  AnalyticsRetentionQueryDto,
  AnalyticsSeriesQueryDto,
} from './dto/admin-analytics-query.dto';
import {
  AnalyticsBreakdownDto,
  AnalyticsFunnelDto,
  AnalyticsGamesDto,
  AnalyticsHealthDto,
  AnalyticsLiveDto,
  AnalyticsMetricsResponseDto,
  AnalyticsOverviewDto,
  AnalyticsPointDto,
  AnalyticsPresenceDto,
  AnalyticsPresenceSampleDto,
  AnalyticsRetentionDto,
  AnalyticsSeriesDto,
} from './dto/admin-analytics-response.dto';

const MAX_POINTS = 400;
const MAX_FUNNEL_DAYS = 90;
const MAX_PRESENCE_MS = 7 * DAY_MS;
const PROVISIONAL_TTL_MS = 60_000;
const PROVISIONAL_CACHE_SIZE = 200;

const OVERVIEW_METRICS: readonly MetricName[] = [
  'visitors',
  'sessions',
  'pageviews',
  'plays',
  'playtime_ms',
  'players',
  'signups',
  'releases_published',
  'mp_sessions',
  'active_browsers_peak',
];

const COMPUTE: Record<RollupClass, typeof activityMetrics> = {
  ACTIVITY: activityMetrics,
  SESSION: sessionMetrics,
  FACT: factMetrics,
  MULTIPLAYER: multiplayerMetrics,
  PRESENCE: presenceMetrics,
};

interface Provisional {
  at: number;
  values: MetricValue[];
  coverage: number;
  errorRate: number;
}

const toDay = (at: Date): string => utcDay(at);
const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const nextDay = (day: string): string => utcDay(new Date(dayDate(day).getTime() + DAY_MS));
const previousDay = (day: string): string => utcDay(new Date(dayDate(day).getTime() - DAY_MS));

/** A peak or a median of nothing has no value; anything else counted nothing. */
export const emptyValueOf = (metric: MetricName): number | null =>
  METRICS[metric].kind === 'max' || metric === 'session_seconds_median' ? null : 0;

/**
 * Answers the admin panel. A period final at the metric's version reads its frozen values; a
 * period not final yet is computed from raw data on read and marked provisional; one whose raw
 * data is already gone is unavailable. Nothing is filled with zeroes it did not count.
 */
@Injectable()
export class AnalyticsQueryService {
  private readonly provisionalCache = new Map<string, Provisional>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly presenceService: PresenceService,
  ) {}

  metrics(): AnalyticsMetricsResponseDto {
    return {
      metrics: METRIC_NAMES.map((name) => ({
        name,
        population: METRICS[name].population,
        kind: METRICS[name].kind,
        finalization: METRICS[name].finalization,
        version: METRICS[name].version,
        dimensions: [...METRICS[name].dimensions],
        definition: METRICS[name].definition,
      })),
      truncatedDimensions: Object.keys(TRUNCATED_DIMENSIONS),
      erasureContract: ERASURE_CONTRACT,
    };
  }

  async series(query: AnalyticsSeriesQueryDto, now = new Date()): Promise<AnalyticsSeriesDto> {
    this.assertRange(query);
    const periods = this.periodsBetween(query.grain, query.from, query.to);
    if (periods.length > MAX_POINTS) {
      throw new BadRequestException(`At most ${String(MAX_POINTS)} periods per series`);
    }
    const dimension = query.dimension ?? '';
    const points = await Promise.all(
      periods.map((period) => this.pointOf(query.metric, dimension, period, now)),
    );
    return {
      metric: query.metric,
      dimension,
      grain: query.grain,
      definitionVersion: METRICS[query.metric].version,
      points,
    };
  }

  async breakdown(
    query: AnalyticsBreakdownQueryDto,
    now = new Date(),
  ): Promise<AnalyticsBreakdownDto> {
    const metric = METRICS[query.metric];
    if (!(metric.dimensions as readonly string[]).includes(query.dimension)) {
      throw new BadRequestException(`${query.metric} is not split by ${query.dimension}`);
    }
    const period = periodOf(query.grain, query.day);
    const { status, values } = await this.valuesOf(query.metric, period, now);
    const prefix = `${query.dimension}:`;
    const split = values
      .filter((value) => value.metric === query.metric && value.dimension.startsWith(prefix))
      .map((value) => ({ key: value.dimension.slice(prefix.length), value: value.value }))
      .sort((a, b) => b.value - a.value);
    return {
      metric: query.metric,
      dimension: query.dimension,
      grain: query.grain,
      periodStart: period.start,
      status,
      truncated: split.some((value) => value.key === OTHER_DIMENSION_VALUE),
      values: status === 'unavailable' ? [] : split,
    };
  }

  async overview(query: AnalyticsPeriodQueryDto, now = new Date()): Promise<AnalyticsOverviewDto> {
    const period = periodOf(query.grain, query.day);
    const before = periodOf(query.grain, previousDay(period.start));
    const tiles = await Promise.all(
      OVERVIEW_METRICS.map(async (metric) => ({
        metric,
        current: await this.pointOf(metric, '', period, now),
        previous: await this.pointOf(metric, '', before, now),
      })),
    );
    return { grain: query.grain, periodStart: period.start, tiles };
  }

  async live(now = new Date()): Promise<AnalyticsLiveDto> {
    const minute = minuteStart(now);
    const previous = new Date(minute.getTime() - MINUTE_MS);
    const samples = await this.prisma.concurrencySample.findMany({
      where: { at: { gte: new Date(minute.getTime() - 61 * MINUTE_MS) } },
      orderBy: { at: 'asc' },
    });

    const browsers = await this.prisma.analyticsLiveMinute.groupBy({
      by: ['state'],
      where: { minute },
      _count: { _all: true },
    });
    const anonymous = await this.prisma.analyticsAnonTally.groupBy({
      by: ['state'],
      where: { minute },
      _sum: { beats: true },
    });
    const accounts = this.presenceService.countsByKind();
    const browserOf = (state: AnalyticsLiveState): number =>
      browsers.find((row) => row.state === state)?._count._all ?? 0;
    const anonOf = (state: AnalyticsLiveState): number =>
      anonymous.find((row) => row.state === state)?._sum.beats ?? 0;
    const states: AnalyticsLiveState[] = ['BROWSING', 'BUILDING', 'PLAYING', 'HOSTING'];

    const current: AnalyticsPresenceSampleDto = {
      at: minute.toISOString(),
      activeBrowsers: states.reduce((sum, state) => sum + browserOf(state), 0),
      activeBrowsersPlaying: browserOf('PLAYING'),
      activeBrowsersBuilding: browserOf('BUILDING'),
      activeBrowsersHosting: browserOf('HOSTING'),
      anonTabs: states.reduce((sum, state) => sum + anonOf(state), 0),
      anonTabsPlaying: anonOf('PLAYING'),
      anonTabsBuilding: anonOf('BUILDING'),
      anonTabsHosting: anonOf('HOSTING'),
      accounts: accounts.IDLE + accounts.PLAYING + accounts.BUILDING + accounts.HOSTING,
      accountsPlaying: accounts.PLAYING,
      accountsBuilding: accounts.BUILDING,
      accountsHosting: accounts.HOSTING,
    };

    const games = await this.prisma.$queryRaw<
      { releaseId: number; browsers: number; anonTabs: number }[]
    >`
      SELECT "releaseId", sum(browsers)::int AS browsers, sum(anon)::int AS "anonTabs" FROM (
        SELECT "releaseId", count(DISTINCT "visitorId") AS browsers, 0 AS anon
        FROM "AnalyticsLiveMinute"
        WHERE "minute" IN (${minute}, ${previous}) AND "releaseId" IS NOT NULL
        GROUP BY "releaseId"
        UNION ALL
        SELECT "releaseId", 0, sum("beats") FROM "AnalyticsAnonTally"
        WHERE "minute" IN (${minute}, ${previous}) AND "releaseId" <> 0 AND "state" = 'PLAYING'
        GROUP BY "releaseId"
      ) AS playing GROUP BY "releaseId" ORDER BY sum(browsers) + sum(anon) DESC LIMIT 20`;
    const names = await this.namesOf(games.map((game) => game.releaseId));

    return {
      note: 'Browsers and anonymous tabs are counted per minute they were seen, not at one instant; accounts are counted at one instant.',
      samples: samples.slice(-60).map((sample) => ({ ...sample, at: sample.at.toISOString() })),
      current,
      gamesNow: games.map((game) => ({ ...game, name: names.get(game.releaseId) ?? null })),
    };
  }

  async presence(query: AnalyticsPresenceQueryDto): Promise<AnalyticsPresenceDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('from and to must be instants, from first');
    }
    if (to.getTime() - from.getTime() > MAX_PRESENCE_MS) {
      throw new BadRequestException('Minute samples span at most 7 days; use a series for longer');
    }
    const samples = await this.prisma.concurrencySample.findMany({
      where: { at: { gte: from, lte: to } },
      orderBy: { at: 'asc' },
    });
    return { samples: samples.map((sample) => ({ ...sample, at: sample.at.toISOString() })) };
  }

  async retention(query: AnalyticsRetentionQueryDto): Promise<AnalyticsRetentionDto> {
    this.assertRange(query);
    const rows = await this.prisma.analyticsCohort.findMany({
      where: {
        kind: query.kind,
        version: RETENTION_VERSION,
        cohortDay: { gte: dayDate(query.from), lte: dayDate(query.to) },
      },
      orderBy: [{ cohortDay: 'asc' }, { offsetDays: 'asc' }],
    });
    const byDay = new Map<string, typeof rows>();
    for (const row of rows) {
      const day = toDay(row.cohortDay);
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    return {
      kind: query.kind as AnalyticsRetentionKind,
      version: RETENTION_VERSION,
      cohorts: [...byDay.entries()].map(([cohortDay, cohort]) => {
        const size = cohort[0]?.size ?? 0;
        return {
          cohortDay,
          size,
          offsets: RETENTION_OFFSETS.map((offsetDays) => {
            const row = cohort.find((candidate) => candidate.offsetDays === offsetDays);
            const retained = row?.mature ? row.retained : null;
            return {
              offsetDays,
              retained,
              rate: retained !== null && size > 0 ? retained / size : null,
              mature: row?.mature ?? false,
            };
          }),
        };
      }),
    };
  }

  async funnel(query: AnalyticsRangeQueryDto, now = new Date()): Promise<AnalyticsFunnelDto> {
    this.assertRange(query);
    const days = (dayDate(query.to).getTime() - dayDate(query.from).getTime()) / DAY_MS + 1;
    if (days > MAX_FUNNEL_DAYS) {
      throw new BadRequestException(`A funnel spans at most ${String(MAX_FUNNEL_DAYS)} days`);
    }
    if (dayDate(query.from).getTime() < now.getTime() - RAW_RETENTION_DAYS * DAY_MS) {
      throw new BadRequestException('A funnel only covers the days whose raw data is kept');
    }
    const end = nextDay(query.to);
    const [counts] = await this.prisma.$queryRaw<
      [
        {
          visited: number;
          played: number;
          signedUp: number;
          createdProject: number;
          published: number;
        },
      ]
    >`
      WITH population AS (
        SELECT id, "firstSeenAt", "userId" FROM "AnalyticsVisitor"
        WHERE "firstSeenAt" >= ${query.from}::date AND "firstSeenAt" < ${end}::date
      ),
      played AS (
        SELECT pop.id, pop."userId", min(p."startedAt") AS at FROM population pop
        JOIN "AnalyticsSession" s ON s."visitorId" = pop.id
        JOIN "AnalyticsPlay" p ON p."sessionId" = s.id AND p."startedAt" >= pop."firstSeenAt"
        GROUP BY pop.id, pop."userId"
      ),
      signed AS (
        SELECT played.id, played."userId", min(f."at") AS at FROM played
        JOIN "AnalyticsFact" f ON f."type" = 'SIGNUP' AND f."actorUserId" = played."userId"
          AND f."at" >= played.at
        GROUP BY played.id, played."userId"
      ),
      created AS (
        SELECT signed.id, signed."userId", min(f."at") AS at FROM signed
        JOIN "AnalyticsFact" f ON f."type" = 'PROJECT_CREATED' AND f."actorUserId" = signed."userId"
          AND f."at" >= signed.at
        GROUP BY signed.id, signed."userId"
      ),
      published AS (
        SELECT DISTINCT created.id FROM created
        JOIN "AnalyticsFact" f ON f."type" = 'RELEASE_PUBLISHED' AND f."actorUserId" = created."userId"
          AND f."at" >= created.at
      )
      SELECT (SELECT count(*) FROM population)::int AS visited,
             (SELECT count(*) FROM played)::int AS played,
             (SELECT count(*) FROM signed)::int AS "signedUp",
             (SELECT count(*) FROM created)::int AS "createdProject",
             (SELECT count(*) FROM published)::int AS published`;
    return {
      from: query.from,
      to: query.to,
      population: 'Consenting browsers first seen in the range; each step after the previous one',
      steps: [
        { step: 'visited', count: counts.visited },
        { step: 'played', count: counts.played },
        { step: 'signedUp', count: counts.signedUp },
        { step: 'createdProject', count: counts.createdProject },
        { step: 'published', count: counts.published },
      ],
    };
  }

  async games(query: AnalyticsGamesQueryDto, now = new Date()): Promise<AnalyticsGamesDto> {
    const period = periodOf(query.grain, query.day);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort = query.sort ?? 'plays';

    const activity = await this.valuesOf('plays', period, now);
    const multiplayer = await this.valuesOf('mp_sessions', period, now);
    const status =
      activity.status === 'unavailable' || multiplayer.status === 'unavailable'
        ? 'unavailable'
        : activity.status === 'provisional' || multiplayer.status === 'provisional'
          ? 'provisional'
          : 'final';

    const games = new Map<
      number,
      { plays: number; playtimeMs: number; players: number; mpSessions: number }
    >();
    const field: Record<string, 'plays' | 'playtimeMs' | 'players' | 'mpSessions'> = {
      plays: 'plays',
      playtime_ms: 'playtimeMs',
      players: 'players',
      mp_sessions: 'mpSessions',
    };
    for (const value of [...activity.values, ...multiplayer.values]) {
      const key = field[value.metric];
      if (!key || !value.dimension.startsWith('release:')) {
        continue;
      }
      const releaseId = Number(value.dimension.slice('release:'.length));
      if (!Number.isInteger(releaseId)) {
        continue;
      }
      const game = games.get(releaseId) ?? { plays: 0, playtimeMs: 0, players: 0, mpSessions: 0 };
      game[key] = value.value;
      games.set(releaseId, game);
    }

    const sortField = field[sort] ?? 'plays';
    const ranked = [...games.entries()].sort((a, b) => b[1][sortField] - a[1][sortField]);
    const slice = ranked.slice((page - 1) * limit, page * limit);
    const names = await this.namesOf(slice.map(([releaseId]) => releaseId));
    return {
      grain: query.grain,
      periodStart: period.start,
      status,
      items: slice.map(([releaseId, game]) => ({
        releaseId,
        name: names.get(releaseId) ?? null,
        ...game,
      })),
      total: ranked.length,
      page,
      limit,
    };
  }

  async health(now = new Date()): Promise<AnalyticsHealthDto> {
    const since = new Date(now.getTime() - DAY_MS);
    const ingest = await this.prisma.analyticsIngestStat.aggregate({
      where: { minute: { gte: since } },
      _sum: { accepted: true, rejected: true, throttled: true, writeErrors: true },
    });
    const finalization = await Promise.all(
      ROLLUP_CLASSES.map(async (rollupClass) => {
        const [metric] = metricsOf(rollupClass);
        const last = metric
          ? await this.prisma.analyticsRollupStatus.findFirst({
              where: { metric, version: METRICS[metric].version, grain: 'DAY', status: 'FINAL' },
              orderBy: { periodStart: 'desc' },
              select: { periodStart: true },
            })
          : null;
        return { finalization: rollupClass, lastFinalDay: last ? toDay(last.periodStart) : null };
      }),
    );
    const backlog = await this.prisma.analyticsProjectionWork.count();
    const oldest = await this.prisma.analyticsProjectionWork.findFirst({
      orderBy: { enqueuedAt: 'asc' },
      select: { enqueuedAt: true },
    });
    const earliest = Object.values(await earliestRawDay(this.prisma))
      .filter((day): day is string => day !== null)
      .sort()[0];
    return {
      ingest: {
        accepted: ingest._sum.accepted ?? 0,
        rejected: ingest._sum.rejected ?? 0,
        throttled: ingest._sum.throttled ?? 0,
        writeErrors: ingest._sum.writeErrors ?? 0,
      },
      finalization,
      projectionBacklog: backlog,
      oldestProjectionWork: oldest?.enqueuedAt.toISOString() ?? null,
      oldestRawDay: earliest ?? null,
    };
  }

  /** One point of a metric: its frozen value, a provisional one, or none. */
  async pointOf(
    metric: MetricName,
    dimension: string,
    period: Period,
    now: Date,
  ): Promise<AnalyticsPointDto> {
    const version = METRICS[metric].version;
    const status = await this.prisma.analyticsRollupStatus.findUnique({
      where: {
        metric_version_grain_periodStart: {
          metric,
          version,
          grain: period.grain,
          periodStart: dayDate(period.start),
        },
      },
    });
    if (status?.status === 'FINAL') {
      const row = await this.prisma.analyticsRollup.findUnique({
        where: {
          metric_version_grain_periodStart_dimension: {
            metric,
            version,
            grain: period.grain,
            periodStart: dayDate(period.start),
            dimension,
          },
        },
        select: { value: true },
      });
      return {
        periodStart: period.start,
        value: row?.value ?? emptyValueOf(metric),
        status: 'final',
        samplerCoverage: status.samplerCoverage,
        ingestErrorRate: status.ingestErrorRate,
      };
    }
    if (status || this.beyondRawData(period, now)) {
      return this.unavailable(period);
    }
    const provisional = await this.provisional(
      METRICS[metric].finalization as RollupClass,
      period,
      now,
    );
    const value = provisional.values.find(
      (candidate) => candidate.metric === metric && candidate.dimension === dimension,
    );
    return {
      periodStart: period.start,
      value: value?.value ?? emptyValueOf(metric),
      status: 'provisional',
      samplerCoverage: provisional.coverage,
      ingestErrorRate: provisional.errorRate,
    };
  }

  /** Every stored or computed value of a metric's class for one period. */
  private async valuesOf(
    metric: MetricName,
    period: Period,
    now: Date,
  ): Promise<{ status: AnalyticsPointDto['status']; values: MetricValue[] }> {
    const point = await this.pointOf(metric, '', period, now);
    const rollupClass = METRICS[metric].finalization as RollupClass;
    if (point.status === 'unavailable') {
      return { status: 'unavailable', values: [] };
    }
    if (point.status === 'provisional') {
      return {
        status: 'provisional',
        values: (await this.provisional(rollupClass, period, now)).values,
      };
    }
    const rows = await this.prisma.analyticsRollup.findMany({
      where: {
        grain: period.grain,
        periodStart: dayDate(period.start),
        OR: metricsOf(rollupClass).map((name) => ({
          metric: name,
          version: METRICS[name].version,
        })),
      },
      select: { metric: true, dimension: true, value: true },
    });
    return {
      status: 'final',
      values: rows.map((row) => ({ ...row, metric: row.metric as MetricName })),
    };
  }

  private async provisional(
    rollupClass: RollupClass,
    period: Period,
    now: Date,
  ): Promise<Provisional> {
    const key = `${rollupClass}|${period.grain}|${period.start}`;
    const cached = this.provisionalCache.get(key);
    if (cached && now.getTime() - cached.at < PROVISIONAL_TTL_MS) {
      return cached;
    }
    const range: DayRange = { start: period.start, end: period.end };
    const computed: Provisional = {
      at: now.getTime(),
      values: truncateDimensions(await COMPUTE[rollupClass](this.prisma, range)),
      coverage: await samplerCoverage(this.prisma, range),
      errorRate: await ingestErrorRate(this.prisma, range),
    };
    if (this.provisionalCache.size >= PROVISIONAL_CACHE_SIZE) {
      this.provisionalCache.clear();
    }
    this.provisionalCache.set(key, computed);
    return computed;
  }

  /** A period starting before the raw window was purged before it could be computed. */
  private beyondRawData(period: Period, now: Date): boolean {
    return dayDate(period.start).getTime() < now.getTime() - RAW_RETENTION_DAYS * DAY_MS;
  }

  private unavailable(period: Period): AnalyticsPointDto {
    return {
      periodStart: period.start,
      value: null,
      status: 'unavailable',
      samplerCoverage: null,
      ingestErrorRate: null,
    };
  }

  private periodsBetween(grain: AnalyticsGrain, from: string, to: string): Period[] {
    const periods: Period[] = [];
    let period = periodOf(grain, from);
    while (period.start <= to && periods.length <= MAX_POINTS) {
      periods.push(period);
      period = periodOf(grain, period.end);
    }
    return periods;
  }

  private assertRange(query: AnalyticsRangeQueryDto): void {
    if (Number.isNaN(dayDate(query.from).getTime()) || Number.isNaN(dayDate(query.to).getTime())) {
      throw new BadRequestException('from and to must be real days');
    }
    if (query.from > query.to) {
      throw new BadRequestException('from must not be after to');
    }
  }

  private async namesOf(releaseIds: number[]): Promise<Map<number, string>> {
    if (releaseIds.length === 0) {
      return new Map();
    }
    const projects = await this.prisma.project.findMany({
      where: { id: { in: releaseIds } },
      select: { id: true, name: true, publishedName: true },
    });
    return new Map(projects.map((project) => [project.id, project.publishedName ?? project.name]));
  }
}
