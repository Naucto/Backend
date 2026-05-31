import { Injectable } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { TargetLinkService } from "./services/target-link.service";

const ACTIVE_WORK_SESSION_WINDOW_MS = 15 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type CountValue = number | bigint | null;

type TopGameRow = {
  projectId: number;
  name: string;
  value: CountValue;
  views?: CountValue;
  likes?: CountValue;
  comments?: CountValue;
};

function numberValue(value: CountValue | undefined): number {
  return Number(value ?? 0);
}

function displayProjectName(project: {
  name: string;
  publishedName?: string | null;
}): string {
  return project.publishedName || project.name;
}

function formatDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mapTopGameRows(
  rows: TopGameRow[]
): Array<{ projectId: number; name: string; value: number; views: number; likes: number; comments: number }> {
  return rows.map((row) => ({
    projectId: row.projectId,
    name: row.name,
    value: numberValue(row.value),
    views: numberValue(row.views),
    likes: numberValue(row.likes),
    comments: numberValue(row.comments)
  }));
}

type DailyRollup = {
  date: Date;
  accountsCreated: number;
  logins: number;
  projectsCreated: number;
  projectsPublished: number;
  projectsUnpublished: number;
  commentsCreated: number;
  likesCreated: number;
  likesRemoved: number;
  gameViews: number;
  gameSessionsStarted: number;
  gameSessionsEnded: number;
  workSessionsStarted: number;
  workSessionsJoined: number;
  workSessionsLeft: number;
};

function buildDailyHistory(rows: DailyRollup[], days: number): DailyRollup[] {
  const start = new Date(Date.now() - Math.max(days - 1, 0) * ONE_DAY_MS);
  start.setUTCHours(0, 0, 0, 0);

  const rowByDate = new Map(rows.map((row) => [formatDateKey(row.date), row]));

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * ONE_DAY_MS);
    const key = formatDateKey(date);
    const row = rowByDate.get(key);

    return {
      date,
      accountsCreated: row?.accountsCreated ?? 0,
      logins: row?.logins ?? 0,
      projectsCreated: row?.projectsCreated ?? 0,
      projectsPublished: row?.projectsPublished ?? 0,
      projectsUnpublished: row?.projectsUnpublished ?? 0,
      commentsCreated: row?.commentsCreated ?? 0,
      likesCreated: row?.likesCreated ?? 0,
      likesRemoved: row?.likesRemoved ?? 0,
      gameViews: row?.gameViews ?? 0,
      gameSessionsStarted: row?.gameSessionsStarted ?? 0,
      gameSessionsEnded: row?.gameSessionsEnded ?? 0,
      workSessionsStarted: row?.workSessionsStarted ?? 0,
      workSessionsJoined: row?.workSessionsJoined ?? 0,
      workSessionsLeft: row?.workSessionsLeft ?? 0
    };
  });
}

@Injectable()
export class AdminInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targetLinks: TargetLinkService
  ) {}

  async getLiveActivity(): Promise<Record<string, unknown>> {
    const activeWorkSessionCutoff = new Date(
      Date.now() - ACTIVE_WORK_SESSION_WINDOW_MS
    );
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const last7Days = new Date(Date.now() - 7 * ONE_DAY_MS);

    const [
      activeGames,
      activeWork,
      recentGames,
      gamesToday,
      games7Days,
      gamesAllTime,
      workToday,
      work7Days,
      workAllTime
    ] = await Promise.all([
      this.prisma.gameSession.findMany({
        where: { endedAt: null },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          hostId: true,
          startedAt: true,
          otherUsers: { select: { id: true } },
          project: {
            select: {
              id: true,
              name: true,
              publishedName: true,
              viewCount: true,
              likes: true
            }
          }
        }
      }),
      this.prisma.workSession.findMany({
        where: { lastActiveAt: { gte: activeWorkSessionCutoff } },
        orderBy: { lastActiveAt: "desc" },
        take: 20,
        select: {
          id: true,
          hostId: true,
          startedAt: true,
          lastActiveAt: true,
          users: { select: { id: true } },
          project: {
            select: { id: true, name: true, publishedName: true }
          }
        }
      }),
      this.prisma.gameSession.findMany({
        orderBy: { startedAt: "desc" },
        take: 12,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          otherUsers: { select: { id: true } },
          project: {
            select: { id: true, name: true, publishedName: true }
          }
        }
      }),
      this.prisma.gameSession.count({ where: { startedAt: { gte: today } } }),
      this.prisma.gameSession.count({ where: { startedAt: { gte: last7Days } } }),
      this.prisma.gameSession.count(),
      this.prisma.workSession.count({ where: { startedAt: { gte: today } } }),
      this.prisma.workSession.count({ where: { startedAt: { gte: last7Days } } }),
      this.prisma.workSession.count()
    ]);

    const playerIds = new Set<number>();
    for (const session of activeGames) {
      playerIds.add(session.hostId);
      session.otherUsers.forEach((user) => playerIds.add(user.id));
    }

    const creatorIds = new Set<number>();
    for (const session of activeWork) {
      creatorIds.add(session.hostId);
      session.users.forEach((user) => creatorIds.add(user.id));
    }

    return {
      metrics: {
        activePlayers: playerIds.size,
        activeGameSessions: activeGames.length,
        activeCreators: creatorIds.size,
        activeWorkSessions: activeWork.length,
        gamesToday,
        games7Days,
        gamesAllTime,
        workToday,
        work7Days,
        workAllTime
      },
      activeGames: activeGames.map((session) => ({
        id: session.id,
        projectId: session.project.id,
        name: displayProjectName(session.project),
        players: 1 + session.otherUsers.length,
        views: session.project.viewCount,
        likes: session.project.likes,
        startedAt: session.startedAt.toISOString()
      })),
      activeWork: activeWork.map((session) => ({
        id: session.id,
        projectId: session.project.id,
        name: displayProjectName(session.project),
        creators: new Set([session.hostId, ...session.users.map((user) => user.id)]).size,
        startedAt: session.startedAt.toISOString(),
        lastActiveAt: session.lastActiveAt.toISOString()
      })),
      recentGames: recentGames.map((session) => ({
        id: session.id,
        projectId: session.project.id,
        name: displayProjectName(session.project),
        players: 1 + session.otherUsers.length,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null
      }))
    };
  }

  async getSocialOverview(): Promise<Record<string, unknown>> {
    const now = new Date();
    const [
      likes,
      comments,
      visibleComments,
      deletedComments,
      hiddenComments,
      friendships,
      friendRequests,
      subscriptions,
      activeSubscriptions,
      topLikedGames,
      topCommentedGames
    ] = await Promise.all([
      this.prisma.like.count(),
      this.prisma.comment.count(),
      this.prisma.comment.count({ where: { deleted: false, hidden: false } }),
      this.prisma.comment.count({ where: { deleted: true } }),
      this.prisma.comment.count({ where: { hidden: true } }),
      this.prisma.friendship.count(),
      this.prisma.friendRequest.count(),
      this.prisma.subscription.count(),
      this.prisma.subscription.count({
        where: { OR: [{ endDate: null }, { endDate: { gt: now } }] }
      }),
      this.prisma.project.findMany({
        where: { hidden: false },
        orderBy: { likes: "desc" },
        take: 8,
        select: {
          id: true,
          name: true,
          publishedName: true,
          likes: true,
          viewCount: true
        }
      }),
      this.prisma.$queryRaw<TopGameRow[]>`
        SELECT
          p.id AS "projectId",
          COALESCE(p."publishedName", p.name) AS name,
          COUNT(c.id)::int AS value,
          p."viewCount"::int AS views,
          p.likes::int AS likes
        FROM "Comment" c
        INNER JOIN "Project" p ON p.id = c."projectId"
        WHERE p.hidden = false
        GROUP BY p.id
        ORDER BY value DESC
        LIMIT 8
      `
    ]);

    return {
      metrics: {
        likes,
        comments,
        visibleComments,
        deletedComments,
        hiddenComments,
        friendships,
        friendRequests,
        subscriptions,
        activeSubscriptions
      },
      commentBreakdown: [
        { name: "Visible", value: visibleComments },
        { name: "Deleted", value: deletedComments },
        { name: "Hidden", value: hiddenComments }
      ],
      topLikedGames: topLikedGames.map((project) => ({
        projectId: project.id,
        name: displayProjectName(project),
        value: project.likes,
        likes: project.likes,
        views: project.viewCount
      })),
      topCommentedGames: mapTopGameRows(topCommentedGames)
    };
  }

  async getDashboard(days = 30): Promise<Record<string, unknown>> {
    const safeDays = Math.max(1, Math.min(365, Math.trunc(days)));
    const start = new Date(Date.now() - (safeDays - 1) * ONE_DAY_MS);
    start.setUTCHours(0, 0, 0, 0);
    const last7Days = new Date(Date.now() - 7 * ONE_DAY_MS);
    const last24Hours = new Date(Date.now() - ONE_DAY_MS);
    const activeWorkSessionCutoff = new Date(
      Date.now() - ACTIVE_WORK_SESSION_WINDOW_MS
    );

    const [
      activeGameSessions,
      activeWorkSessions,
      totalUsers,
      accountStatusCounts,
      projectStatusCounts,
      reportStatusCounts,
      moderationActionCounts,
      projectAggregate,
      publishedProjects,
      hiddenProjects,
      totalComments,
      deletedComments,
      hiddenComments,
      openReports,
      reportsLast7Days,
      moderationActionsLast7Days,
      likes,
      totalGameSessions,
      endedGameSessions,
      totalWorkSessions,
      eventsLast24Hours,
      daily,
      topGamesByViews,
      topGamesByLikes,
      topGamesByPlays,
      topGamesByComments,
      recentReports
    ] = await Promise.all([
      this.prisma.gameSession.findMany({
        where: { endedAt: null },
        select: {
          id: true,
          hostId: true,
          projectId: true,
          startedAt: true,
          otherUsers: { select: { id: true } },
          project: {
            select: {
              id: true,
              name: true,
              publishedName: true,
              viewCount: true,
              likes: true
            }
          }
        }
      }),
      this.prisma.workSession.findMany({
        where: { lastActiveAt: { gte: activeWorkSessionCutoff } },
        select: {
          id: true,
          hostId: true,
          projectId: true,
          lastActiveAt: true,
          users: { select: { id: true } },
          project: { select: { id: true, name: true, publishedName: true } }
        }
      }),
      this.prisma.user.count(),
      this.prisma.user.groupBy({
        by: ["accountStatus"],
        _count: { _all: true }
      }),
      this.prisma.project.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      this.prisma.report.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      this.prisma.moderationAction.groupBy({
        by: ["action"],
        where: { createdAt: { gte: start } },
        _count: { _all: true }
      }),
      this.prisma.project.aggregate({
        _count: { _all: true },
        _sum: { viewCount: true, likes: true }
      }),
      this.prisma.project.count({
        where: { status: "COMPLETED", hidden: false }
      }),
      this.prisma.project.count({ where: { hidden: true } }),
      this.prisma.comment.count(),
      this.prisma.comment.count({ where: { deleted: true } }),
      this.prisma.comment.count({ where: { hidden: true } }),
      this.prisma.report.count({
        where: { status: { in: ["OPEN", "IN_REVIEW"] } }
      }),
      this.prisma.report.count({ where: { createdAt: { gte: last7Days } } }),
      this.prisma.moderationAction.count({
        where: { createdAt: { gte: last7Days } }
      }),
      this.prisma.like.count(),
      this.prisma.gameSession.count(),
      this.prisma.gameSession.count({ where: { endedAt: { not: null } } }),
      this.prisma.workSession.count(),
      this.prisma.analyticsEvent.count({
        where: { createdAt: { gte: last24Hours } }
      }),
      this.prisma.dailyAnalyticsRollup.findMany({
        where: { date: { gte: start } },
        orderBy: { date: "asc" }
      }),
      this.prisma.project.findMany({
        where: { hidden: false },
        orderBy: { viewCount: "desc" },
        take: 8,
        select: {
          id: true,
          name: true,
          publishedName: true,
          viewCount: true,
          likes: true
        }
      }),
      this.prisma.project.findMany({
        where: { hidden: false },
        orderBy: { likes: "desc" },
        take: 8,
        select: {
          id: true,
          name: true,
          publishedName: true,
          viewCount: true,
          likes: true
        }
      }),
      this.prisma.$queryRaw<TopGameRow[]>`
        SELECT
          p.id AS "projectId",
          COALESCE(p."publishedName", p.name) AS name,
          COUNT(gs.id)::int AS value,
          p."viewCount"::int AS views,
          p.likes::int AS likes
        FROM "GameSession" gs
        INNER JOIN "Project" p ON p.id = gs."projectId"
        WHERE p.hidden = false
        GROUP BY p.id
        ORDER BY value DESC, views DESC
        LIMIT 8
      `,
      this.prisma.$queryRaw<TopGameRow[]>`
        SELECT
          p.id AS "projectId",
          COALESCE(p."publishedName", p.name) AS name,
          COUNT(c.id)::int AS value,
          p."viewCount"::int AS views,
          p.likes::int AS likes
        FROM "Comment" c
        INNER JOIN "Project" p ON p.id = c."projectId"
        WHERE p.hidden = false AND c.hidden = false AND c.deleted = false
        GROUP BY p.id
        ORDER BY value DESC, views DESC
        LIMIT 8
      `,
      this.prisma.report.findMany({
        where: { status: { in: ["OPEN", "IN_REVIEW"] } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          targetType: true,
          targetId: true,
          status: true,
          reason: true,
          createdAt: true
        }
      })
    ]);

    const currentPlayerIds = new Set<number>();
    const activeGameByProject = new Map<
      number,
      {
        projectId: number;
        name: string;
        value: number;
        players: Set<number>;
        views: number;
        likes: number;
      }
    >();

    for (const session of activeGameSessions) {
      currentPlayerIds.add(session.hostId);
      const row = activeGameByProject.get(session.projectId) ?? {
        projectId: session.projectId,
        name: displayProjectName(session.project),
        value: 0,
        players: new Set<number>(),
        views: session.project.viewCount,
        likes: session.project.likes
      };
      row.value += 1;
      row.players.add(session.hostId);
      for (const user of session.otherUsers) {
        currentPlayerIds.add(user.id);
        row.players.add(user.id);
      }
      activeGameByProject.set(session.projectId, row);
    }

    const currentCreatorIds = new Set<number>();
    const activeWorkByProject = new Map<
      number,
      {
        projectId: number;
        name: string;
        value: number;
        creators: Set<number>;
      }
    >();

    for (const session of activeWorkSessions) {
      currentCreatorIds.add(session.hostId);
      const row = activeWorkByProject.get(session.projectId) ?? {
        projectId: session.projectId,
        name: displayProjectName(session.project),
        value: 0,
        creators: new Set<number>()
      };
      row.value += 1;
      row.creators.add(session.hostId);
      for (const user of session.users) {
        currentCreatorIds.add(user.id);
        row.creators.add(user.id);
      }
      activeWorkByProject.set(session.projectId, row);
    }

    const accountBreakdown = accountStatusCounts.map((row) => ({
      name: row.accountStatus,
      value: row._count._all
    }));
    const projectBreakdown = projectStatusCounts.map((row) => ({
      name: row.status ?? "UNKNOWN",
      value: row._count._all
    }));
    const reportBreakdown = reportStatusCounts.map((row) => ({
      name: row.status,
      value: row._count._all
    }));
    const moderationActionBreakdown = moderationActionCounts
      .map((row) => ({
        name: row.action,
        value: row._count._all
      }))
      .sort((left, right) => right.value - left.value);
    const dailyHistory = buildDailyHistory(daily, safeDays);
    const activeGames = Array.from(activeGameByProject.values())
      .map((row) => ({
        projectId: row.projectId,
        name: row.name,
        value: row.value,
        players: row.players.size,
        views: row.views,
        likes: row.likes
      }))
      .sort((left, right) => right.players - left.players)
      .slice(0, 8);
    const activeCreationProjects = Array.from(activeWorkByProject.values())
      .map((row) => ({
        projectId: row.projectId,
        name: row.name,
        value: row.value,
        creators: row.creators.size
      }))
      .sort((left, right) => right.creators - left.creators)
      .slice(0, 8);

    const targetLinks = await this.targetLinks.resolve(
      recentReports.map((report) => ({
        id: report.targetId,
        type: report.targetType
      }))
    );

    return {
      current: {
        players: currentPlayerIds.size,
        creators: currentCreatorIds.size,
        activeGameSessions: activeGameSessions.length,
        activeWorkSessions: activeWorkSessions.length
      },
      totals: {
        users: totalUsers,
        activeUsers:
          accountBreakdown.find((row) => row.name === "ACTIVE")?.value ?? 0,
        suspendedUsers:
          accountBreakdown.find((row) => row.name === "SUSPENDED")?.value ?? 0,
        bannedUsers:
          accountBreakdown.find((row) => row.name === "BANNED")?.value ?? 0,
        totalProjects: projectAggregate._count._all,
        publishedProjects,
        hiddenProjects,
        totalViews: projectAggregate._sum.viewCount ?? 0,
        totalProjectLikes: projectAggregate._sum.likes ?? 0,
        comments: totalComments,
        deletedComments,
        hiddenComments,
        openReports,
        reportsLast7Days,
        moderationActionsLast7Days,
        likes,
        totalGameSessions,
        endedGameSessions,
        totalWorkSessions,
        eventsLast24Hours
      },
      breakdowns: {
        accounts: accountBreakdown,
        projects: projectBreakdown,
        reports: reportBreakdown,
        moderationActions: moderationActionBreakdown
      },
      top: {
        activeGames,
        activeCreationProjects,
        byViews: topGamesByViews.map((project) => ({
          projectId: project.id,
          name: displayProjectName(project),
          value: project.viewCount,
          views: project.viewCount,
          likes: project.likes
        })),
        byLikes: topGamesByLikes.map((project) => ({
          projectId: project.id,
          name: displayProjectName(project),
          value: project.likes,
          views: project.viewCount,
          likes: project.likes
        })),
        byPlays: mapTopGameRows(topGamesByPlays),
        byComments: mapTopGameRows(topGamesByComments)
      },
      recentReports: recentReports.map((report) => {
        const link = targetLinks.get(`${report.targetType}:${report.targetId}`);
        return {
          id: report.id,
          targetType: report.targetType,
          targetId: report.targetId,
          status: report.status,
          reason: report.reason,
          createdAt: report.createdAt.toISOString(),
          targetLabel:
            link?.label ?? `${report.targetType} #${report.targetId}`
        };
      }),
      daily: dailyHistory.map((row) => ({
        date: formatDateKey(row.date),
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
}
