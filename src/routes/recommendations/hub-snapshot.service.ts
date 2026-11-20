import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HubSnapshot, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CollectionsService } from '../collections/collections.service';
import { hubTags } from '../project/hub-fields';
import { LIVE_COMMENT, LIVE_COMMENT_SQL, PUBLISHED } from '../project/project-select';
import { activity, DailySignals, engagement, TRENDING_WINDOW_DAYS } from './hub-scoring';
import { composeSnapshot, HubCandidate, HubSnapshotPayload } from './hub-snapshot';
import { RecommendationsService } from './recommendations.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days a snapshot is kept: what the hub showed stays answerable for two months. */
const RETENTION_DAYS = 60;

/** Lets the server finish starting before a day without a snapshot is computed. */
const CATCH_UP_DELAY_MS = 10_000;

type SignalRow = DailySignals & { projectId: number };

/** The UTC day of an instant, at its midnight. */
function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

type StoredPayload = Omit<HubSnapshotPayload, 'collections'> &
  Partial<Pick<HubSnapshotPayload, 'collections'>>;

/** A row written before collections had a shelf holds none. */
const payloadOf = (snapshot: HubSnapshot): HubSnapshotPayload => {
  const stored = snapshot.payload as unknown as StoredPayload;

  return { ...stored, collections: stored.collections ?? { total: 0, ids: [] } };
};

/**
 * Computes the hub once per UTC day and keeps it: the shelves a day shows are drawn when the day
 * starts and read from its row afterwards, so every visitor of a day sees the same hub. Only whole
 * days before the one computed feed it, which makes computing a day again write the same row.
 */
@Injectable()
export class HubSnapshotService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(HubSnapshotService.name);
  private catchUp: NodeJS.Timeout | null = null;
  private computing: { day: number; snapshot: Promise<HubSnapshot> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendations: RecommendationsService,
    private readonly collections: CollectionsService,
  ) {}

  onApplicationBootstrap(): void {
    this.catchUp = setTimeout(
      () =>
        void this.today().catch((error: unknown) =>
          this.logger.warn(`Hub snapshot not computed at start: ${String(error)}`),
        ),
      CATCH_UP_DELAY_MS,
    );
    this.catchUp.unref();
  }

  onApplicationShutdown(): void {
    if (this.catchUp) {
      clearTimeout(this.catchUp);
    }
  }

  /** The games on the hub with what the whole days before `day` say of them. */
  private async readCandidates(day: Date): Promise<HubCandidate[]> {
    const from = new Date(day.getTime() - TRENDING_WINDOW_DAYS * DAY_MS);

    const [games, signals] = await Promise.all([
      this.prisma.project.findMany({
        where: PUBLISHED,
        select: {
          id: true,
          userId: true,
          tags: true,
          publishedTags: true,
          viewCount: true,
          likes: true,
          publishedAt: true,
          firstPublishedAt: true,
          _count: { select: { forks: true, comments: { where: LIVE_COMMENT } } },
        },
      }),
      // A play is a dated view of a consenting browser or a play started by one that declined;
      // the two never count the same play.
      this.prisma.$queryRaw<SignalRow[]>`
        SELECT "projectId",
               (${day}::date - "day") AS "ageDays",
               SUM("plays")::int AS "plays",
               SUM("likes")::int AS "likes",
               SUM("comments")::int AS "comments",
               SUM("forks")::int AS "forks"
        FROM (
          SELECT "projectId", "day", COUNT(*) AS "plays", 0 AS "likes", 0 AS "comments", 0 AS "forks"
          FROM "ReleaseView"
          WHERE "day" >= ${from} AND "day" < ${day}
          GROUP BY 1, 2
          UNION ALL
          SELECT "releaseId", "minute"::date, SUM("playsStarted"), 0, 0, 0
          FROM "AnalyticsAnonTally"
          WHERE "minute" >= ${from} AND "minute" < ${day} AND "releaseId" <> 0
          GROUP BY 1, 2
          UNION ALL
          SELECT "projectId", "createdAt"::date, 0, COUNT(*), 0, 0
          FROM "Like"
          WHERE "createdAt" >= ${from} AND "createdAt" < ${day}
          GROUP BY 1, 2
          UNION ALL
          SELECT "projectId", "createdAt"::date, 0, 0, COUNT(*), 0
          FROM "Comment"
          WHERE ${LIVE_COMMENT_SQL} AND "createdAt" >= ${from} AND "createdAt" < ${day}
          GROUP BY 1, 2
          UNION ALL
          SELECT "forked_from_id", "createdAt"::date, 0, 0, 0, COUNT(*)
          FROM "Project"
          WHERE "forked_from_id" IS NOT NULL AND "createdAt" >= ${from} AND "createdAt" < ${day}
          GROUP BY 1, 2
        ) AS "signal"
        GROUP BY 1, 2`,
    ]);

    const days = new Map<number, DailySignals[]>();
    for (const { projectId, ...signal } of signals) {
      days.set(projectId, [...(days.get(projectId) ?? []), signal]);
    }

    return games.map((game) => ({
      id: game.id,
      authorId: game.userId,
      tags: hubTags(game),
      lifetime: engagement({
        plays: game.viewCount,
        likes: game.likes,
        comments: game._count.comments,
        forks: game._count.forks,
      }),
      activity: activity(days.get(game.id) ?? []),
      daysOut:
        (day.getTime() - (game.firstPublishedAt ?? game.publishedAt ?? day).getTime()) / DAY_MS,
    }));
  }

  /** Computes `day`, writes its row over any it already has, and drops the rows past retention. */
  private async write(day: Date, now: Date): Promise<HubSnapshot> {
    const [candidates, collections] = await Promise.all([
      this.readCandidates(day),
      this.collections.listedWithGames(),
    ]);

    // The best trending game of the days just read, then the most played, lead the vote.
    await this.recommendations.electGameOfTheWeek(
      [...candidates]
        .sort((a, b) => b.activity - a.activity || b.lifetime - a.lifetime || a.id - b.id)
        .map((game) => game.id),
      now,
    );

    const yesterday = await this.prisma.hubSnapshot.findUnique({
      where: { day: new Date(day.getTime() - DAY_MS) },
    });
    const payload = composeSnapshot(
      candidates,
      collections,
      day.toISOString().slice(0, 10),
      yesterday && payloadOf(yesterday),
    ) as unknown as Prisma.InputJsonObject;

    const snapshot = await this.prisma.hubSnapshot.upsert({
      where: { day },
      create: { day, computedAt: now, payload },
      update: { computedAt: now, payload },
    });
    await this.prisma.hubSnapshot.deleteMany({
      where: { day: { lt: new Date(day.getTime() - RETENTION_DAYS * DAY_MS) } },
    });

    return snapshot;
  }

  /**
   * One computation of a day at a time, joined by whoever asks while it runs: two at once would
   * each pick a game of the week. Holds while the backend runs as one instance.
   */
  private compute(day: Date, now: Date): Promise<HubSnapshot> {
    if (this.computing?.day === day.getTime()) {
      return this.computing.snapshot;
    }

    const snapshot = this.write(day, now).finally(() => {
      if (this.computing?.day === day.getTime()) {
        this.computing = null;
      }
    });
    this.computing = { day: day.getTime(), snapshot };

    return snapshot;
  }

  @Cron('0 5 0 * * *', { timeZone: 'UTC' })
  async refresh(now = new Date()): Promise<void> {
    try {
      await this.compute(utcDay(now), now);
    } catch (error) {
      this.logger.warn(`Hub snapshot not refreshed: ${String(error)}`);
    }
  }

  /** The snapshot of the day `now` falls in, computed first when that day has none. */
  async today(now = new Date()): Promise<{ day: string; payload: HubSnapshotPayload }> {
    const day = utcDay(now);
    const snapshot =
      (await this.prisma.hubSnapshot.findUnique({ where: { day } })) ??
      (await this.compute(day, now));

    return { day: snapshot.day.toISOString().slice(0, 10), payload: payloadOf(snapshot) };
  }
}
