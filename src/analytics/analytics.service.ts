import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AnalyticsEventType, Prisma } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";

type AnalyticsRecordInput = {
  userId?: number | null;
  projectId?: number | null;
  commentId?: number | null;
  metadata?: Prisma.InputJsonValue;
};

const ROLLUP_INCREMENT_BY_EVENT: Partial<
  Record<AnalyticsEventType, keyof Prisma.DailyAnalyticsRollupUpdateInput>
> = {
  ACCOUNT_CREATED: "accountsCreated",
  LOGIN: "logins",
  PROJECT_CREATED: "projectsCreated",
  PROJECT_PUBLISHED: "projectsPublished",
  PROJECT_UNPUBLISHED: "projectsUnpublished",
  COMMENT_CREATED: "commentsCreated",
  COMMENT_REPLIED: "commentsCreated",
  LIKE_CREATED: "likesCreated",
  LIKE_REMOVED: "likesRemoved",
  GAME_VIEWED: "gameViews",
  GAME_SESSION_STARTED: "gameSessionsStarted",
  GAME_SESSION_ENDED: "gameSessionsEnded",
  WORK_SESSION_STARTED: "workSessionsStarted",
  WORK_SESSION_JOINED: "workSessionsJoined",
  WORK_SESSION_LEFT: "workSessionsLeft"
};

const ACTIVE_WORK_SESSION_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getRollupDate(date = new Date()): Date {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate()
    ));
  }

  async record(
    type: AnalyticsEventType,
    input: AnalyticsRecordInput = {}
  ): Promise<void> {
    const createdAt = new Date();
    const rollupDate = this.getRollupDate(createdAt);
    const incrementField = ROLLUP_INCREMENT_BY_EVENT[type];

    try {
      await this.prisma.$transaction([
        this.prisma.analyticsEvent.create({
          data: {
            type,
            userId: input.userId ?? null,
            projectId: input.projectId ?? null,
            commentId: input.commentId ?? null,
            metadata: input.metadata ?? Prisma.JsonNull,
            createdAt
          }
        }),
        this.prisma.dailyAnalyticsRollup.upsert({
          where: { date: rollupDate },
          create: {
            date: rollupDate,
            ...(incrementField ? { [incrementField]: 1 } : {})
          },
          update: incrementField
            ? { [incrementField]: { increment: 1 } }
            : {}
        })
      ]);
    } catch (error) {
      this.logger.warn(
        `Failed to record analytics event ${type}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async getDashboardStats(days = 30): Promise<{
    currentPlayers: number;
    currentCreators: number;
    totals: {
      users: number;
      activeUsers: number;
      suspendedUsers: number;
      bannedUsers: number;
      publishedProjects: number;
      hiddenProjects: number;
      comments: number;
      openReports: number;
      likes: number;
    };
    daily: Array<Record<string, number | string>>;
  }> {
    const start = this.getRollupDate(
      new Date(Date.now() - Math.max(days - 1, 0) * 24 * 60 * 60 * 1000)
    );
    const activeWorkSessionCutoff = new Date(
      Date.now() - ACTIVE_WORK_SESSION_WINDOW_MS
    );

    const [
      currentPlayers,
      currentCreators,
      users,
      activeUsers,
      suspendedUsers,
      bannedUsers,
      publishedProjects,
      hiddenProjects,
      comments,
      openReports,
      likes,
      daily
    ] = await Promise.all([
      this.prisma.gameSession.count({ where: { endedAt: null } }),
      this.prisma.workSession.count({
        where: { lastActiveAt: { gte: activeWorkSessionCutoff } }
      }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { accountStatus: "ACTIVE" } }),
      this.prisma.user.count({ where: { accountStatus: "SUSPENDED" } }),
      this.prisma.user.count({ where: { accountStatus: "BANNED" } }),
      this.prisma.project.count({
        where: { status: "COMPLETED", hidden: false }
      }),
      this.prisma.project.count({ where: { hidden: true } }),
      this.prisma.comment.count({ where: { hidden: false, deleted: false } }),
      this.prisma.report.count({ where: { status: { in: ["OPEN", "IN_REVIEW"] } } }),
      this.prisma.like.count(),
      this.prisma.dailyAnalyticsRollup.findMany({
        where: { date: { gte: start } },
        orderBy: { date: "asc" }
      })
    ]);

    return {
      currentPlayers,
      currentCreators,
      totals: {
        users,
        activeUsers,
        suspendedUsers,
        bannedUsers,
        publishedProjects,
        hiddenProjects,
        comments,
        openReports,
        likes
      },
      daily: daily.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        accountsCreated: row.accountsCreated,
        logins: row.logins,
        projectsCreated: row.projectsCreated,
        projectsPublished: row.projectsPublished,
        projectsUnpublished: row.projectsUnpublished,
        commentsCreated: row.commentsCreated,
        likesCreated: row.likesCreated,
        likesRemoved: row.likesRemoved,
        gameViews: row.gameViews,
        gameSessionsStarted: row.gameSessionsStarted,
        gameSessionsEnded: row.gameSessionsEnded,
        workSessionsStarted: row.workSessionsStarted,
        workSessionsJoined: row.workSessionsJoined,
        workSessionsLeft: row.workSessionsLeft
      }))
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneRawEvents(): Promise<void> {
    const retentionDays = Number(
      process.env["RAW_ANALYTICS_RETENTION_DAYS"] ?? "180"
    );
    const safeRetentionDays = Number.isFinite(retentionDays)
      ? Math.max(1, Math.trunc(retentionDays))
      : 180;
    const threshold = new Date(
      Date.now() - safeRetentionDays * 24 * 60 * 60 * 1000
    );

    await this.prisma.analyticsEvent.deleteMany({
      where: { createdAt: { lt: threshold } }
    });
  }
}
