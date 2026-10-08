import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AnalyticsErasureService,
  releaseViewKeyOfUser,
  releaseViewKeyOfVisitor,
} from './analytics-erasure.service';
import { utcDay } from './analytics-time';
import {
  UserAnalyticsEraseResponseDto,
  UserAnalyticsExportDto,
  UserAnalyticsSummaryDto,
} from './dto/user-analytics.dto';

const TOP_GAMES = 5;

interface GameTotal {
  releaseId: number;
  plays: number;
  playtimeMs: number;
}

/**
 * What analytics holds about one account: a summary for its settings and the admin panel, a full
 * export, and erasure. The history projected from final days is combined with the raw activity of
 * the days not projected yet, so the summary is current.
 */
@Injectable()
export class UserAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly erasure: AnalyticsErasureService,
  ) {}

  async summary(userId: number, now = new Date()): Promise<UserAnalyticsSummaryDto> {
    const monthStart = `${utcDay(now).slice(0, 8)}01`;
    const visitors = await this.prisma.analyticsVisitor.findMany({
      where: { userId },
      select: { id: true },
    });

    // Projected history, then raw activity of each linked visitor after its watermark.
    const games = await this.prisma.$queryRaw<
      (GameTotal & { monthPlays: number; monthPlaytimeMs: number })[]
    >`
      WITH history AS (
        SELECT "releaseId", "day", "plays", "activeMs" FROM "AnalyticsUserDaily"
        WHERE "userId" = ${userId} AND "releaseId" <> 0
        UNION ALL
        SELECT p."releaseId", p."startedAt"::date, 1, 0 FROM "AnalyticsPlay" p
        JOIN "AnalyticsSession" s ON s.id = p."sessionId"
        JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
        WHERE v."userId" = ${userId} AND NOT p."continued"
          AND p."startedAt"::date > COALESCE(v."projectedThrough", '1970-01-01'::date)
        UNION ALL
        SELECT p."releaseId", d."day", 0, d."activeMs" FROM "AnalyticsPlayDay" d
        JOIN "AnalyticsPlay" p ON p.id = d."playId"
        JOIN "AnalyticsSession" s ON s.id = p."sessionId"
        JOIN "AnalyticsVisitor" v ON v.id = s."visitorId"
        WHERE v."userId" = ${userId}
          AND d."day" > COALESCE(v."projectedThrough", '1970-01-01'::date)
      )
      SELECT "releaseId",
             sum("plays")::int AS plays,
             sum("activeMs")::float8 AS "playtimeMs",
             (sum("plays") FILTER (WHERE "day" >= ${monthStart}::date))::int AS "monthPlays",
             COALESCE(sum("activeMs") FILTER (WHERE "day" >= ${monthStart}::date), 0)::float8 AS "monthPlaytimeMs"
      FROM history GROUP BY "releaseId"`;

    const [lastRaw] = await this.prisma.$queryRaw<[{ at: Date | null }]>`
      SELECT max(s."lastSeenAt") AS at FROM "AnalyticsSession" s
      JOIN "AnalyticsVisitor" v ON v.id = s."visitorId" WHERE v."userId" = ${userId}`;
    const lastProjected = lastRaw.at
      ? null
      : await this.prisma.analyticsUserDaily.findFirst({
          where: { userId },
          orderBy: { day: 'desc' },
          select: { day: true },
        });

    const top = [...games].sort((a, b) => b.playtimeMs - a.playtimeMs).slice(0, TOP_GAMES);
    const names = await this.namesOf(top.map((game) => game.releaseId));
    return {
      tracked: visitors.length > 0,
      linkedBrowsers: visitors.length,
      lifetime: {
        plays: games.reduce((sum, game) => sum + game.plays, 0),
        playtimeMs: games.reduce((sum, game) => sum + game.playtimeMs, 0),
      },
      thisMonth: {
        plays: games.reduce((sum, game) => sum + (game.monthPlays ?? 0), 0),
        playtimeMs: games.reduce((sum, game) => sum + game.monthPlaytimeMs, 0),
      },
      gamesPlayed: games.filter((game) => game.plays > 0 || game.playtimeMs > 0).length,
      topGames: top.map((game) => ({
        releaseId: game.releaseId,
        name: names.get(game.releaseId) ?? null,
        plays: game.plays,
        playtimeMs: game.playtimeMs,
      })),
      lastActiveAt: lastRaw.at?.toISOString() ?? lastProjected?.day.toISOString() ?? null,
      lastActiveIsExact: lastRaw.at !== null,
    };
  }

  async export(userId: number, now = new Date()): Promise<UserAnalyticsExportDto> {
    const visitors = await this.prisma.analyticsVisitor.findMany({
      where: { userId },
      select: { id: true, firstSeenAt: true, lastSeenAt: true, linkedAt: true },
    });
    const visitorIds = visitors.map((visitor) => visitor.id);
    const sessions = await this.prisma.analyticsSession.findMany({
      where: { visitorId: { in: visitorIds } },
      orderBy: { startedAt: 'asc' },
    });
    const sessionIds = sessions.map((session) => session.id);
    const sessionDays = await this.prisma.$queryRaw<
      {
        sessionId: string;
        day: string;
        pageViews: number;
        activeMinutes: number;
        buildMinutes: number;
        playMs: number;
      }[]
    >`
      SELECT "sessionId"::text AS "sessionId", to_char("day", 'YYYY-MM-DD') AS day, "pageViews",
             bit_count("activeBits")::int AS "activeMinutes",
             bit_count("buildBits")::int AS "buildMinutes", "playMs"::float8 AS "playMs"
      FROM "AnalyticsSessionDay" WHERE "sessionId"::text = ANY(${sessionIds}::text[])
      ORDER BY "day"`;
    const pageViews = await this.prisma.analyticsPageView.findMany({
      where: { sessionId: { in: sessionIds } },
      orderBy: { occurredAt: 'asc' },
      select: { sessionId: true, occurredAt: true, route: true },
    });
    const plays = await this.prisma.analyticsPlay.findMany({
      where: { sessionId: { in: sessionIds } },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        sessionId: true,
        releaseId: true,
        continued: true,
        startedAt: true,
        activeMs: true,
        endedAt: true,
      },
    });
    const history = await this.prisma.analyticsUserDaily.findMany({
      where: { userId },
      orderBy: [{ day: 'asc' }, { releaseId: 'asc' }],
    });
    const facts = await this.prisma.analyticsFact.findMany({
      where: { actorUserId: userId },
      orderBy: { at: 'asc' },
      select: { type: true, at: true, projectId: true },
    });
    const releaseViews = await this.prisma.releaseView.findMany({
      where: {
        viewerKey: {
          in: [releaseViewKeyOfUser(userId), ...visitorIds.map(releaseViewKeyOfVisitor)],
        },
      },
      orderBy: { day: 'asc' },
      select: { projectId: true, day: true },
    });

    const iso = (at: Date | null): string | null => at?.toISOString() ?? null;
    return {
      exportedAt: now.toISOString(),
      note: 'Raw activity (sessions, page views, plays) is kept 90 days; the history by day is kept while the account exists. Business facts are kept 90 days.',
      browsers: visitors.map((visitor) => ({
        id: visitor.id,
        firstSeenAt: visitor.firstSeenAt.toISOString(),
        lastSeenAt: visitor.lastSeenAt.toISOString(),
        linkedAt: iso(visitor.linkedAt),
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        visitorId: session.visitorId,
        startedAt: session.startedAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        closedAt: iso(session.closedAt),
        referrerDomain: session.referrerDomain,
        utmSource: session.utmSource,
        utmMedium: session.utmMedium,
        utmCampaign: session.utmCampaign,
        device: session.device,
        browser: session.browser,
        os: session.os,
        country: session.country,
        screen: session.screen,
        language: session.language,
      })),
      sessionDays,
      pageViews: pageViews.map((view) => ({ ...view, occurredAt: view.occurredAt.toISOString() })),
      plays: plays.map((play) => ({
        ...play,
        startedAt: play.startedAt.toISOString(),
        activeMs: Number(play.activeMs),
        endedAt: iso(play.endedAt),
      })),
      history: history.map((day) => ({
        day: utcDay(day.day),
        releaseId: day.releaseId,
        plays: day.plays,
        activeMs: Number(day.activeMs),
        activeMinutes: day.activeMinutes,
      })),
      facts: facts.map((fact) => ({
        type: fact.type,
        at: fact.at.toISOString(),
        projectId: fact.projectId,
      })),
      releaseViews: releaseViews.map((view) => ({
        projectId: view.projectId,
        day: utcDay(view.day),
      })),
    };
  }

  async erase(userId: number): Promise<UserAnalyticsEraseResponseDto> {
    return { erasedBrowsers: await this.erasure.erase(userId) };
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
