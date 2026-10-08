import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AnalyticsRollupState, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  METRIC_NAMES,
  MetricDimension,
  MetricName,
  METRICS,
  OTHER_DIMENSION_VALUE,
  RETENTION_OFFSETS,
  RETENTION_VERSION,
  TRUNCATED_DIMENSIONS,
} from './analytics-metrics';
import { duePeriods, GRAINS, Period, ROLLUP_CLASSES, RollupClass } from './analytics-periods';
import {
  activityMetrics,
  DayRange,
  earliestRawDay,
  factMetrics,
  ingestErrorRate,
  MetricValue,
  multiplayerMetrics,
  presenceMetrics,
  rollupCohorts,
  samplerCoverage,
  sessionMetrics,
} from './analytics-rollup.queries';

const CATCH_UP_DELAY_MS = 60_000;

const COMPUTE: Record<
  RollupClass,
  (tx: Prisma.TransactionClient, range: DayRange) => Promise<MetricValue[]>
> = {
  ACTIVITY: activityMetrics,
  SESSION: sessionMetrics,
  FACT: factMetrics,
  MULTIPLAYER: multiplayerMetrics,
  PRESENCE: presenceMetrics,
};

export const metricsOf = (rollupClass: RollupClass): MetricName[] =>
  METRIC_NAMES.filter((metric) => METRICS[metric].finalization === rollupClass);

/**
 * Keeps the top values of an unbounded dimension and folds the rest into `(other)`, so a
 * forged or long-tailed value never multiplies the stored rows.
 */
export function truncateDimensions(values: MetricValue[]): MetricValue[] {
  const kept: MetricValue[] = [];
  const groups = new Map<string, MetricValue[]>();
  for (const value of values) {
    const dimension = value.dimension.split(':')[0] as MetricDimension;
    const limit = TRUNCATED_DIMENSIONS[dimension];
    if (value.dimension === '' || limit === undefined) {
      kept.push(value);
      continue;
    }
    const key = `${value.metric}|${dimension}`;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  for (const group of groups.values()) {
    const [first] = group;
    if (!first) {
      continue;
    }
    const dimension = first.dimension.split(':')[0] as MetricDimension;
    const limit = TRUNCATED_DIMENSIONS[dimension] ?? group.length;
    const sorted = [...group].sort((a, b) => b.value - a.value);
    kept.push(...sorted.slice(0, limit));
    const rest = sorted.slice(limit);
    if (rest.length > 0) {
      kept.push({
        metric: first.metric,
        dimension: `${dimension}:${OTHER_DIMENSION_VALUE}`,
        value: rest.reduce((sum, value) => sum + value.value, 0),
      });
    }
  }
  return kept;
}

/**
 * Freezes analytics period by period: once a period of a class is due, its values are computed
 * from the raw data and written with a FINAL status, and never computed again. Every due period
 * still missing a status for a current metric version is caught up, oldest first.
 */
@Injectable()
export class AnalyticsFinalizeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsFinalizeService.name);
  private running = false;
  private catchUp: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.catchUp = setTimeout(() => void this.finalizeDue(), CATCH_UP_DELAY_MS);
    this.catchUp.unref();
  }

  onApplicationShutdown(): void {
    if (this.catchUp) {
      clearTimeout(this.catchUp);
    }
  }

  @Cron('0 5 * * * *', { timeZone: 'UTC' })
  async finalizeDue(now = new Date()): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    let finalized = 0;
    try {
      // Every class starts from the first day any class has data: a day without multiplayer
      // has multiplayer metrics of zero, final like any other, so the purge can rely on it.
      const fromDay = Object.values(await earliestRawDay(this.prisma))
        .filter((day): day is string => day !== null)
        .sort()[0];
      if (fromDay === undefined) {
        return 0;
      }
      for (const rollupClass of ROLLUP_CLASSES) {
        for (const grain of GRAINS) {
          for (const period of await this.pendingPeriods(rollupClass, grain, fromDay, now)) {
            if (await this.finalizePeriod(rollupClass, period)) {
              finalized += 1;
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Analytics finalization stopped: ${String(error)}`);
    } finally {
      this.running = false;
    }
    if (finalized > 0) {
      this.logger.log(`Finalized ${String(finalized)} analytics period(s)`);
    }
    return finalized;
  }

  /** Due periods where any metric of the class has no status yet at its current version. */
  async pendingPeriods(
    rollupClass: RollupClass,
    grain: Period['grain'],
    fromDay: string,
    now: Date,
  ): Promise<Period[]> {
    const due = duePeriods(rollupClass, grain, fromDay, now);
    const [first] = due;
    if (!first) {
      return [];
    }
    const metrics = metricsOf(rollupClass);
    const done = await this.prisma.analyticsRollupStatus.findMany({
      where: {
        grain,
        metric: { in: metrics },
        periodStart: { gte: new Date(`${first.start}T00:00:00.000Z`) },
      },
      select: { metric: true, version: true, periodStart: true },
    });
    const doneKeys = new Set(
      done
        .filter((status) => METRICS[status.metric as MetricName].version === status.version)
        .map((status) => `${status.metric}|${status.periodStart.toISOString().slice(0, 10)}`),
    );
    return due.filter((period) =>
      metrics.some((metric) => !doneKeys.has(`${metric}|${period.start}`)),
    );
  }

  /** Computes and freezes one period of one class; false when another runner holds it. */
  async finalizePeriod(rollupClass: RollupClass, period: Period): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<[{ locked: boolean }]>`
          SELECT pg_try_advisory_xact_lock(hashtext('analytics-finalize')) AS locked`;
        if (!locked) {
          return false;
        }

        const range = { start: period.start, end: period.end };
        const values = truncateDimensions(await COMPUTE[rollupClass](tx, range));
        const coverage = await samplerCoverage(tx, range);
        const errorRate = await ingestErrorRate(tx, range);
        const periodStart = new Date(`${period.start}T00:00:00.000Z`);
        const metrics = metricsOf(rollupClass);

        for (const metric of metrics) {
          const version = METRICS[metric].version;
          await tx.analyticsRollup.deleteMany({
            where: { metric, version, grain: period.grain, periodStart },
          });
        }
        await tx.analyticsRollup.createMany({
          data: values.map((value) => ({
            metric: value.metric,
            version: METRICS[value.metric].version,
            grain: period.grain,
            periodStart,
            dimension: value.dimension,
            value: value.value,
          })),
        });
        await tx.analyticsRollupStatus.createMany({
          data: metrics.map((metric) => ({
            metric,
            version: METRICS[metric].version,
            grain: period.grain,
            periodStart,
            status: AnalyticsRollupState.FINAL,
            samplerCoverage: coverage,
            ingestErrorRate: errorRate,
          })),
          skipDuplicates: true,
        });

        if (rollupClass === 'ACTIVITY' && period.grain === 'DAY') {
          await rollupCohorts(tx, period.start, RETENTION_OFFSETS, RETENTION_VERSION);
        }
        return true;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60_000,
        maxWait: 10_000,
      },
    );
  }
}
