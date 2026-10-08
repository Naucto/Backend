import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { metricsOf } from './analytics-finalize.service';
import { METRICS } from './analytics-metrics';
import { GRAINS, periodOf, ROLLUP_CLASSES } from './analytics-periods';
import { DAY_MS, utcDay, VISITOR_COOKIE_MS } from './analytics-time';
import { lockPurgeGate, lockVisitors } from './identity-locks';

/** Raw activity is kept this long, and then only once everything built from it is final. */
export const RAW_RETENTION_DAYS = 90;
const VISITOR_BATCH = 100;

export type DayPurge = 'purged' | 'not-final' | 'not-projected';

/**
 * Deletes raw analytics once nothing still needs it. A day goes when it is older than the raw
 * retention, every class is final for it, its ISO week and its month, and every linked visitor
 * active on it has had that day copied into its account history. A visitor goes once its cookie
 * can no longer be presented and its activity is gone, and is tombstoned so a stale cookie never
 * recreates it.
 */
@Injectable()
export class AnalyticsPurgeService {
  private readonly logger = new Logger(AnalyticsPurgeService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 30 2 * * *', { timeZone: 'UTC' })
  async purge(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const cutoff = utcDay(new Date(now.getTime() - RAW_RETENTION_DAYS * DAY_MS));
      for (const day of await this.rawDaysBefore(cutoff)) {
        const outcome = await this.purgeDay(day);
        if (outcome !== 'purged') {
          // Days are purged oldest first: a later day cannot be purged before this one.
          this.logger.warn(`Raw analytics of ${day} kept: ${outcome}`);
          break;
        }
      }
      await this.expireVisitors(now);
      await this.expireKeys(now);
    } catch (error) {
      this.logger.warn(`Analytics purge stopped: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Purges one day's raw activity when everything built from it is safe, in one transaction. */
  async purgeDay(day: string): Promise<DayPurge> {
    return this.prisma.$transaction(
      async (tx): Promise<DayPurge> => {
        await lockPurgeGate(tx, 'exclusive');

        if (!(await this.everyClassFinal(tx, day))) {
          return 'not-final';
        }
        const [{ unprojected }] = await tx.$queryRaw<[{ unprojected: number }]>`
          SELECT count(DISTINCT v.id)::int AS unprojected
          FROM "AnalyticsSessionDay" d
          JOIN "AnalyticsSession" s ON s.id = d."sessionId"
          JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
          WHERE d."day" = ${day}::date AND v."userId" IS NOT NULL
            AND (v."projectedThrough" IS NULL OR v."projectedThrough" < ${day}::date)`;
        if (unprojected > 0) {
          return 'not-projected';
        }

        const next = utcDay(new Date(new Date(`${day}T00:00:00.000Z`).getTime() + DAY_MS));
        await tx.$executeRaw`DELETE FROM "AnalyticsSessionDay" WHERE "day" = ${day}::date`;
        await tx.$executeRaw`DELETE FROM "AnalyticsPlayDay" WHERE "day" = ${day}::date`;
        await tx.$executeRaw`
          DELETE FROM "AnalyticsPageView" WHERE "occurredAt" < ${next}::date`;
        await tx.$executeRaw`
          DELETE FROM "AnalyticsPlay" p WHERE p."startedAt" < ${next}::date
            AND NOT EXISTS (SELECT 1 FROM "AnalyticsPlayDay" d WHERE d."playId" = p.id)`;
        await tx.$executeRaw`
          DELETE FROM "AnalyticsSession" s WHERE s."startedAt" < ${next}::date
            AND NOT EXISTS (SELECT 1 FROM "AnalyticsSessionDay" d WHERE d."sessionId" = s.id)
            AND NOT EXISTS (SELECT 1 FROM "AnalyticsPageView" v WHERE v."sessionId" = s.id)
            AND NOT EXISTS (SELECT 1 FROM "AnalyticsPlay" p WHERE p."sessionId" = s.id)`;
        await tx.$executeRaw`DELETE FROM "AnalyticsAnonTally" WHERE "minute" < ${next}::date`;
        await tx.$executeRaw`DELETE FROM "AnalyticsFact" WHERE "at" < ${next}::date`;
        await tx.$executeRaw`DELETE FROM "AnalyticsMpDay" WHERE "day" = ${day}::date`;
        await tx.$executeRaw`
          DELETE FROM "AnalyticsMpSeat" WHERE "firstConnectedAt" < ${next}::date`;
        await tx.$executeRaw`
          DELETE FROM "AnalyticsMpSession" m
          WHERE GREATEST(m."createdAt", COALESCE(m."firstConnectedAt", m."createdAt"),
                         COALESCE(m."reachedMultiAt", m."createdAt")) < ${next}::date
            AND (m."endedAt" IS NOT NULL OR m."createdAt" < ${next}::date - interval '1 day')
            AND NOT EXISTS (SELECT 1 FROM "AnalyticsMpDay" d WHERE d."sessionId" = m.id)
            AND NOT EXISTS (SELECT 1 FROM "AnalyticsMpSeat" seat WHERE seat."sessionId" = m.id)`;
        await tx.$executeRaw`DELETE FROM "ConcurrencySample" WHERE "at" < ${next}::date`;
        await tx.$executeRaw`DELETE FROM "AnalyticsIngestStat" WHERE "minute" < ${next}::date`;
        return 'purged';
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  /** Every class final for the day, for its week and for its month, at current versions. */
  async everyClassFinal(tx: Prisma.TransactionClient, day: string): Promise<boolean> {
    for (const rollupClass of ROLLUP_CLASSES) {
      const [metric] = metricsOf(rollupClass);
      if (!metric) {
        continue;
      }
      for (const grain of GRAINS) {
        const period = periodOf(grain, day);
        const status = await tx.analyticsRollupStatus.findUnique({
          where: {
            metric_version_grain_periodStart: {
              metric,
              version: METRICS[metric].version,
              grain,
              periodStart: new Date(`${period.start}T00:00:00.000Z`),
            },
          },
          select: { status: true },
        });
        if (!status) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Deletes visitors whose cookie can no longer be presented, idle past the raw retention and
   * without activity left, tombstoning each so the same id is refused if it ever comes back.
   */
  async expireVisitors(now: Date): Promise<number> {
    const firstSeenBefore = new Date(now.getTime() - VISITOR_COOKIE_MS);
    const lastSeenBefore = new Date(now.getTime() - RAW_RETENTION_DAYS * DAY_MS);
    let expired = 0;
    for (;;) {
      const batch = await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.analyticsVisitor.findMany({
          where: {
            firstSeenAt: { lt: firstSeenBefore },
            lastSeenAt: { lt: lastSeenBefore },
            sessions: { none: {} },
          },
          select: { id: true },
          take: VISITOR_BATCH,
        });
        const ids = candidates.map((candidate) => candidate.id);
        if (ids.length === 0) {
          return 0;
        }
        await lockVisitors(tx, ids, 'exclusive');
        await tx.analyticsVisitorTombstone.createMany({
          data: ids.map((id) => ({ id, erasedAt: now })),
          skipDuplicates: true,
        });
        const deleted = await tx.analyticsVisitor.deleteMany({
          where: { id: { in: ids }, sessions: { none: {} } },
        });
        return deleted.count;
      });
      expired += batch;
      if (batch < VISITOR_BATCH) {
        return expired;
      }
    }
  }

  /** Forgets tombstones and anonymous view keys no cookie can still match. */
  async expireKeys(now: Date): Promise<void> {
    const before = new Date(now.getTime() - VISITOR_COOKIE_MS);
    await this.prisma.analyticsVisitorTombstone.deleteMany({ where: { erasedAt: { lt: before } } });
    await this.prisma.releaseView.deleteMany({
      where: { viewerKey: { startsWith: 'v:' }, createdAt: { lt: before } },
    });
  }

  private async rawDaysBefore(cutoff: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT to_char(day, 'YYYY-MM-DD') AS day FROM (
        SELECT "day" FROM "AnalyticsSessionDay"
        UNION SELECT "occurredAt"::date FROM "AnalyticsPageView"
        UNION SELECT "minute"::date FROM "AnalyticsAnonTally"
        UNION SELECT "at"::date FROM "AnalyticsFact"
        UNION SELECT "day" FROM "AnalyticsMpDay"
        UNION SELECT "at"::date FROM "ConcurrencySample"
      ) AS raw (day)
      WHERE day < ${cutoff}::date
      ORDER BY 1`;
    return rows.map((row) => row.day);
  }
}
