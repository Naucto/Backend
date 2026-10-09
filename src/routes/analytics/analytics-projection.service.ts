import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { METRICS } from './analytics-metrics';
import { MINUTE_MS } from './analytics-time';
import { lockAccount } from './identity-locks';

const BATCH = 50;
const MAX_BACKOFF_MS = 60 * MINUTE_MS;
/** How long work waits when no day is final yet, without counting as a failure. */
const NOTHING_FINAL_RETRY_MS = 15 * MINUTE_MS;

type Outcome = 'projected' | 'waiting' | 'dropped';

/**
 * Keeps each account's lifetime history (AnalyticsUserDaily) from the raw activity of its linked
 * visitors. Rows of a visitor's day are replaced from raw, never added to, so projecting a day
 * again changes nothing. Work is durable: linking queues it in its own transaction, failures back
 * off and retry, and an hourly scan queues every linked visitor left behind, from its watermark.
 * Only days final for activity are projected, so a projected day never changes after.
 */
@Injectable()
export class AnalyticsProjectionService {
  private readonly logger = new Logger(AnalyticsProjectionService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  @Interval(30_000)
  async processDue(now = new Date()): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    let projected = 0;
    try {
      const due = await this.prisma.analyticsProjectionWork.findMany({
        where: { nextAttemptAt: { lte: now } },
        orderBy: { nextAttemptAt: 'asc' },
        take: BATCH,
      });
      for (const work of due) {
        try {
          const outcome = await this.project(work.visitorId, work.userId);
          if (outcome === 'waiting') {
            await this.prisma.analyticsProjectionWork.updateMany({
              where: { visitorId: work.visitorId },
              data: { nextAttemptAt: new Date(now.getTime() + NOTHING_FINAL_RETRY_MS) },
            });
          } else {
            projected += outcome === 'projected' ? 1 : 0;
          }
        } catch (error) {
          const attempts = work.attempts + 1;
          const backoff = Math.min(MINUTE_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
          await this.prisma.analyticsProjectionWork.updateMany({
            where: { visitorId: work.visitorId },
            data: {
              attempts,
              nextAttemptAt: new Date(now.getTime() + backoff),
              lastError: String(error).slice(0, 500),
            },
          });
          this.logger.warn(`Projection of visitor ${work.visitorId} failed: ${String(error)}`);
        }
      }
    } finally {
      this.running = false;
    }
    return projected;
  }

  /** Queues every linked visitor whose history lags behind its activity. */
  @Cron('0 15 * * * *', { timeZone: 'UTC' })
  async recoveryScan(now = new Date()): Promise<number> {
    const latest = await this.latestFinalDay(this.prisma);
    if (latest === null) {
      return 0;
    }
    return this.prisma.$executeRaw`
      INSERT INTO "AnalyticsProjectionWork" ("visitorId", "userId", "enqueuedAt", "nextAttemptAt")
      SELECT v.id, v."userId", ${now}, ${now} FROM "AnalyticsVisitor" v
      WHERE v."userId" IS NOT NULL
        AND (v."projectedThrough" IS NULL OR v."projectedThrough" < ${latest}::date)
        AND EXISTS (
          SELECT 1 FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
          WHERE s."visitorId" = v.id
            AND d."day" > COALESCE(v."projectedThrough", '1970-01-01'::date)
            AND d."day" <= ${latest}::date)
      ON CONFLICT ("visitorId") DO NOTHING`;
  }

  /**
   * Replaces the visitor's history rows of every final day after its watermark, then moves the
   * watermark and drops the work. Holds the account lock shared, so it waits for an erasure and
   * then finds nothing to project.
   */
  async project(visitorId: string, userId: number): Promise<Outcome> {
    return this.prisma.$transaction(
      async (tx): Promise<Outcome> => {
        await lockAccount(tx, userId, 'shared');
        const visitor = await tx.analyticsVisitor.findUnique({
          where: { id: visitorId },
          select: { userId: true, projectedThrough: true },
        });
        if (!visitor || visitor.userId !== userId) {
          await tx.analyticsProjectionWork.deleteMany({ where: { visitorId } });
          return 'dropped';
        }
        const latest = await this.latestFinalDay(tx);
        if (latest === null) {
          return 'waiting';
        }
        const after = visitor.projectedThrough?.toISOString().slice(0, 10) ?? '1970-01-01';

        await tx.analyticsUserDaily.deleteMany({
          where: {
            userId,
            visitorId,
            day: {
              gt: new Date(`${after}T00:00:00.000Z`),
              lte: new Date(`${latest}T00:00:00.000Z`),
            },
          },
        });
        await tx.$executeRaw`
          INSERT INTO "AnalyticsUserDaily" ("userId", "visitorId", "day", "releaseId", "plays", "activeMs", "activeMinutes")
          SELECT ${userId}, ${visitorId}::uuid, day, release,
                 sum(plays)::int, sum(ms)::bigint, sum(minutes)::int
          FROM (
            SELECT d."day" AS day, 0 AS release, 0 AS plays, 0::bigint AS ms,
                   bit_count(d."activeBits") AS minutes
            FROM "AnalyticsSessionDay" d JOIN "AnalyticsSession" s ON s.id = d."sessionId"
            WHERE s."visitorId" = ${visitorId}::uuid
              AND d."day" > ${after}::date AND d."day" <= ${latest}::date
            UNION ALL
            SELECT p."startedAt"::date, p."releaseId", 1, 0, 0
            FROM "AnalyticsPlay" p JOIN "AnalyticsSession" s ON s.id = p."sessionId"
            WHERE s."visitorId" = ${visitorId}::uuid AND NOT p."continued"
              AND p."startedAt"::date > ${after}::date AND p."startedAt"::date <= ${latest}::date
            UNION ALL
            SELECT d."day", p."releaseId", 0, d."activeMs", 0
            FROM "AnalyticsPlayDay" d JOIN "AnalyticsPlay" p ON p.id = d."playId"
            JOIN "AnalyticsSession" s ON s.id = p."sessionId"
            WHERE s."visitorId" = ${visitorId}::uuid
              AND d."day" > ${after}::date AND d."day" <= ${latest}::date
          ) AS activity
          GROUP BY day, release`;
        await tx.analyticsVisitor.update({
          where: { id: visitorId },
          data: { projectedThrough: new Date(`${latest}T00:00:00.000Z`) },
        });
        await tx.analyticsProjectionWork.deleteMany({ where: { visitorId } });
        return 'projected';
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  /** The last day final for activity, as `YYYY-MM-DD`, or null when none is yet. */
  private async latestFinalDay(db: Prisma.TransactionClient): Promise<string | null> {
    const [row] = await db.$queryRaw<[{ day: string | null }]>`
      SELECT to_char(max("periodStart"), 'YYYY-MM-DD') AS day FROM "AnalyticsRollupStatus"
      WHERE "metric" = 'visitors' AND "version" = ${METRICS.visitors.version}
        AND "grain" = 'DAY' AND "status" = 'FINAL'`;
    return row.day;
  }
}
