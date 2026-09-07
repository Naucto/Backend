import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ProjectService } from "@project/project.service";
import { NotificationsService } from "src/notifications/notifications.service";
import {
  FeaturedReleaseDto,
  FeaturedReleaseHistoryDto,
  FeaturedReleaseHistoryEntryDto
} from "./dto/featured-release.dto";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

const CURATOR_SELECT = { id: true, username: true } as const;

type FeaturedRow = Prisma.FeaturedReleaseGetPayload<{
  include: { featuredBy: { select: typeof CURATOR_SELECT } };
}>;

@Injectable()
export class CurationService {
  private readonly logger = new Logger(CurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
    private readonly notificationsService: NotificationsService
  ) {}

  /** The current "game of the week", or null when nothing is featured. */
  async getCurrent(): Promise<FeaturedReleaseDto | null> {
    const current = await this.prisma.featuredRelease.findFirst({
      where: { endsAt: null },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      include: { featuredBy: { select: CURATOR_SELECT } }
    });

    if (!current) {
      return null;
    }

    const project = await this.projectService.fetchRelease(current.projectId);
    if (project.status !== "COMPLETED") {
      // The game was unpublished since it was picked: retire the entry.
      await this.endCurrent();
      return null;
    }

    return { ...this.toEntry(current), project };
  }

  async setFeatured(
    projectId: number,
    curatorId: number,
    note?: string
  ): Promise<FeaturedReleaseDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, status: true, userId: true, publishedName: true, name: true }
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }
    if (project.status !== "COMPLETED") {
      throw new BadRequestException("Only published projects can be featured");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.featuredRelease.updateMany({
        where: { endsAt: null },
        data: { endsAt: now }
      });
      return tx.featuredRelease.create({
        data: {
          projectId,
          featuredById: curatorId,
          note: note ?? null,
          startsAt: now
        },
        include: { featuredBy: { select: CURATOR_SELECT } }
      });
    });

    await this.notifyCreator(project.userId, project.publishedName ?? project.name);

    const release = await this.projectService.fetchRelease(projectId);
    return { ...this.toEntry(created), project: release };
  }

  /** Ends the current featured release. Returns whether one was active. */
  async clearFeatured(): Promise<boolean> {
    return (await this.endCurrent()) > 0;
  }

  async getHistory(
    page?: number,
    limit?: number
  ): Promise<FeaturedReleaseHistoryDto> {
    const safePage =
      page !== undefined && Number.isFinite(page) && page >= 1
        ? Math.floor(page)
        : 1;
    const safeLimit =
      limit !== undefined && Number.isFinite(limit) && limit >= 1
        ? Math.min(Math.floor(limit), MAX_HISTORY_LIMIT)
        : DEFAULT_HISTORY_LIMIT;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.featuredRelease.count(),
      this.prisma.featuredRelease.findMany({
        orderBy: [{ startsAt: "desc" }, { id: "desc" }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        include: {
          featuredBy: { select: CURATOR_SELECT },
          project: { select: { id: true, name: true, publishedName: true } }
        }
      })
    ]);

    const items: FeaturedReleaseHistoryEntryDto[] = rows.map((row) => ({
      ...this.toEntry(row),
      project: {
        id: row.project.id,
        name: row.project.publishedName || row.project.name
      }
    }));

    return { items, total, page: safePage, limit: safeLimit };
  }

  private async endCurrent(): Promise<number> {
    const result = await this.prisma.featuredRelease.updateMany({
      where: { endsAt: null },
      data: { endsAt: new Date() }
    });
    return result.count;
  }

  private async notifyCreator(userId: number, gameName: string): Promise<void> {
    try {
      await this.notificationsService.createNotification({
        userId,
        title: "Your game is featured!",
        message: `${gameName} is the game of the week on the Naucto hub.`,
        type: "INFO"
      });
    } catch (error) {
      // Curation must not fail because a notification could not be delivered.
      this.logger.warn(
        `Could not notify user ${userId} about the featured game: ` +
          (error instanceof Error ? error.message : String(error))
      );
    }
  }

  private toEntry(
    row: FeaturedRow
  ): Omit<FeaturedReleaseHistoryEntryDto, "project"> {
    return {
      id: row.id,
      projectId: row.projectId,
      note: row.note,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      featuredBy: row.featuredBy
    };
  }
}
