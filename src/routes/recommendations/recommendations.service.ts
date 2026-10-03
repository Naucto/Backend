import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { pageWindow } from '../../common/page-window';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HubService } from '../project/hub.service';
import { hubName } from '../project/hub-fields';
import { ProjectService } from '../project/project.service';
import {
  FeaturedEntryDto,
  FeaturedReleaseDto,
  FeaturedReleaseHistoryDto,
  FeaturedReleaseHistoryEntryDto,
} from './dto/featured-release.dto';

const DEFAULT_HISTORY_LIMIT = 20;

const CURATOR_SELECT = { id: true, username: true } as const;

type FeaturedRow = Prisma.FeaturedReleaseGetPayload<{
  include: { featuredBy: { select: typeof CURATOR_SELECT } };
}>;

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
    private readonly hubService: HubService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /** Ends the pick still running, or only `id` when given, so that none is current. */
  private async retireCurrentPick(
    client: Prisma.TransactionClient = this.prisma,
    id?: number,
  ): Promise<void> {
    await client.featuredRelease.updateMany({
      where: { endsAt: null, ...(id === undefined ? {} : { id }) },
      data: { endsAt: new Date() },
    });
  }

  private async notifyCreator(userId: number, projectId: number, gameName: string): Promise<void> {
    await this.notificationsService.notifyBestEffort({
      userId,
      title: 'Your game is featured!',
      message: `${gameName} is the game of the week on the Naucto hub.`,
      type: 'INFO',
      kind: 'FEATURED',
      data: { projectId },
    });
  }

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

  /** The current "game of the week", or null when nothing is featured. */
  async getCurrent(): Promise<FeaturedReleaseDto | null> {
    const current = await this.prisma.featuredRelease.findFirst({
      where: { endsAt: null },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
      include: { featuredBy: { select: CURATOR_SELECT } },
    });

    if (!current) {
      return null;
    }

    const project = await this.hubService.fetchRelease(current.projectId);
    if (!project.publishedAt) {
      // The game was unpublished since it was picked: retire the entry.
      await this.retireCurrentPick(this.prisma, current.id);
      return null;
    }

    return { ...this.toEntry(current), project };
  }

  async setFeatured(
    projectId: number,
    curatorId: number,
    note?: string,
  ): Promise<FeaturedReleaseDto> {
    const project = await this.projectService.requireProject(projectId, {
      publishedAt: true,
      userId: true,
      publishedName: true,
      name: true,
    });

    if (!project.publishedAt) {
      throw new BadRequestException('Only published projects can be featured');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.retireCurrentPick(tx);
      return tx.featuredRelease.create({
        data: {
          projectId,
          featuredById: curatorId,
          note: note ?? null,
          startsAt: new Date(),
        },
        include: { featuredBy: { select: CURATOR_SELECT } },
      });
    });

    await this.notifyCreator(project.userId, projectId, hubName(project));

    const release = await this.hubService.fetchRelease(projectId);
    return { ...this.toEntry(created), project: release };
  }

  async clearFeatured(): Promise<void> {
    await this.retireCurrentPick();
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
