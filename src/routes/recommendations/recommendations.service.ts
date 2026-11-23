import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { pageWindow } from '../../common/page-window';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HubService } from '../project/hub.service';
import { hubName } from '../project/hub-fields';
import { ProjectService } from '../project/project.service';
import { ReleaseProject } from '../project/project-select';
import {
  FeaturedEntryDto,
  FeaturedReleaseHistoryDto,
  FeaturedReleaseHistoryEntryDto,
} from './dto/featured-release.dto';

const DEFAULT_HISTORY_LIMIT = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Weeks a game of the week waits before it can be picked again. */
export const WINNER_REST_WEEKS = 8;

const CURATOR_SELECT = { id: true, username: true } as const;

type FeaturedRow = Prisma.FeaturedReleaseGetPayload<{
  include: { featuredBy: { select: typeof CURATOR_SELECT } };
}>;

/** Monday 00:00 UTC of the week `at` falls in. */
function startOfWeek(at: Date): Date {
  const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());

  return new Date(day - ((at.getUTCDay() + 6) % 7) * DAY_MS);
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
    private readonly hubService: HubService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private toEntry(row: FeaturedRow): FeaturedEntryDto {
    return {
      id: row.id,
      projectId: row.projectId,
      note: row.note,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      featuredBy: row.featuredBy,
    };
  }

  /**
   * The current "game of the week", or null when there is none. A pick whose game left the hub
   * reads as none. One its author took down keeps its row: it is the pick again if the game comes
   * back within its week. One moderation withholds is retired.
   */
  async getCurrent(): Promise<(FeaturedEntryDto & { project: ReleaseProject }) | null> {
    const current = await this.prisma.featuredRelease.findFirst({
      where: { endsAt: null },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      include: { featuredBy: { select: CURATOR_SELECT } },
    });
    if (!current) {
      return null;
    }

    const [project] = await this.hubService.fetchReleasesByIds([current.projectId]);
    if (!project) {
      await this.prisma.featuredRelease.updateMany({
        where: { id: current.id, project: { hiddenAt: { not: null } } },
        data: { endsAt: new Date() },
      });
      return null;
    }

    return { ...this.toEntry(current), project };
  }

  /**
   * Picks the game of the week, once per UTC week: the first of `bestFirst` that neither is the
   * running pick nor was picked in the last `WINNER_REST_WEEKS` weeks. The running pick ends
   * either way. A week nobody qualifies for has no pick, and a later call that week tries again.
   */
  async electGameOfTheWeek(bestFirst: number[], now: Date): Promise<void> {
    const weekStart = startOfWeek(now);
    const recent = await this.prisma.featuredRelease.findMany({
      where: {
        OR: [
          { startsAt: { gte: new Date(weekStart.getTime() - WINNER_REST_WEEKS * WEEK_MS) } },
          { endsAt: null },
        ],
      },
      select: { projectId: true, startsAt: true },
    });
    if (recent.some((pick) => pick.startsAt >= weekStart)) {
      return;
    }

    const resting = new Set(recent.map((pick) => pick.projectId));
    const winnerId = bestFirst.find((projectId) => !resting.has(projectId));

    await this.prisma.$transaction(async (tx) => {
      await tx.featuredRelease.updateMany({ where: { endsAt: null }, data: { endsAt: now } });
      if (winnerId !== undefined) {
        await tx.featuredRelease.create({ data: { projectId: winnerId, startsAt: now } });
      }
    });
    if (winnerId === undefined) {
      return;
    }

    const winner = await this.projectService.requireProject(winnerId, {
      userId: true,
      name: true,
      publishedName: true,
    });
    await this.notificationsService.notifyBestEffort({
      userId: winner.userId,
      title: 'Your game is featured!',
      message: `${hubName(winner)} is the game of the week on the Naucto hub.`,
      type: 'INFO',
      kind: 'FEATURED',
      data: { projectId: winnerId },
    });
  }

  async getHistory(page?: number, limit?: number): Promise<FeaturedReleaseHistoryDto> {
    const window = pageWindow(page, limit, DEFAULT_HISTORY_LIMIT);

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.featuredRelease.count(),
      this.prisma.featuredRelease.findMany({
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        skip: window.skip,
        take: window.take,
        include: {
          featuredBy: { select: CURATOR_SELECT },
          project: { select: { id: true, name: true, publishedName: true } },
        },
      }),
    ]);

    const items: FeaturedReleaseHistoryEntryDto[] = rows.map((row) => ({
      ...this.toEntry(row),
      project: {
        id: row.project.id,
        name: hubName(row.project),
      },
    }));

    return { items, total, page: window.page, limit: window.limit };
  }
}
