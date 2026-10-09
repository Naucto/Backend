import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { pageWindow } from '../../common/page-window';
import { isUniqueViolation, PrismaService } from '../../prisma/prisma.service';
import { PROJECT_NAME_MAX_LENGTH } from './dto/project-field-limits';
import { hubFields } from './hub-fields';
import { keepEditTime } from './keep-edit-time';
import { KeylessViewLimiter } from './keyless-view-limiter';
import { ProjectService } from './project.service';
import { ProjectContentService } from './project-content.service';
import {
  DEFAULT_LIMIT,
  PaginatedProjectsResult,
  ProjectEx,
  PUBLISHED,
  ReleaseProject,
  WITH_PEOPLE,
  WITH_PEOPLE_AND_COUNTS,
  withCounts,
} from './project-select';
import { normalizeTags } from './project-tags';
import { viewerKeyOf } from './viewer-key';

export const RELEASE_WINDOWS = ['all', '365d', '30d', '7d'] as const;
export type ReleaseWindow = (typeof RELEASE_WINDOWS)[number];

/**
 * Shelf orderings, applied in the query: a client holds one page and cannot order what it has not
 * fetched.
 */
export const RELEASE_SORTS = ['fresh', 'popular', 'liked', 'discussed', 'name'] as const;
export type ReleaseSort = (typeof RELEASE_SORTS)[number];

const RELEASE_ORDER_BY: Record<ReleaseSort, Prisma.ProjectOrderByWithRelationInput[]> = {
  fresh: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  popular: [{ viewCount: 'desc' }, { publishedAt: 'desc' }],
  liked: [{ likes: 'desc' }, { publishedAt: 'desc' }],
  discussed: [{ comments: { _count: 'desc' } }, { publishedAt: 'desc' }],
  name: [{ publishedName: 'asc' }, { name: 'asc' }],
};

export type PublishedProjectFilters = {
  search?: string;
  tags?: string[];
  releaseWindow?: ReleaseWindow;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const RELEASE_WINDOW_DAYS: Record<Exclude<ReleaseWindow, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '365d': 365,
};

@Injectable()
export class HubService {
  private readonly logger = new Logger(HubService.name);

  private readonly keylessViews = new KeylessViewLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
    private readonly contentService: ProjectContentService,
  ) {}

  /** The row of a project on the hub narrowed to `select`, or a 404 for a draft as for a gap. */
  private async requirePublished<S extends Prisma.ProjectSelect>(
    id: number,
    select: S,
  ): Promise<Prisma.ProjectGetPayload<{ select: S }>> {
    const project = await this.prisma.project.findFirst({ where: { id, ...PUBLISHED }, select });

    if (!project) {
      throw new NotFoundException(`Published project with ID ${id} not found`);
    }

    return project as Prisma.ProjectGetPayload<{ select: S }>;
  }

  /**
   * A tag matches whole or not at all: Prisma compares array members and cannot look inside one.
   */
  private searchClauses(term: string): Prisma.ProjectWhereInput[] {
    const contains = { contains: term, mode: 'insensitive' } as const;

    return [
      { publishedName: contains },
      { name: contains },
      { publishedShortDesc: contains },
      { shortDesc: contains },
      { publishedTags: { hasSome: [term, term.toLowerCase()] } },
      { tags: { hasSome: [term, term.toLowerCase()] } },
      { creator: { username: contains } },
      { creator: { nickname: contains } },
    ];
  }

  private buildPublishedGamesWhere(
    filters: PublishedProjectFilters = {},
  ): Prisma.ProjectWhereInput {
    const where: Prisma.ProjectWhereInput = { ...PUBLISHED };
    const andClauses: Prisma.ProjectWhereInput[] = [];
    const normalizedSearch = filters.search?.trim();
    const normalizedTags = normalizeTags(filters.tags);

    if (filters.releaseWindow && filters.releaseWindow !== 'all') {
      const threshold = new Date(
        Date.now() - RELEASE_WINDOW_DAYS[filters.releaseWindow] * DAY_IN_MS,
      );

      andClauses.push({ publishedAt: { gte: threshold } });
    }

    if (normalizedSearch) {
      andClauses.push({ OR: this.searchClauses(normalizedSearch) });
    }

    if (normalizedTags.length > 0) {
      andClauses.push({
        OR: [
          {
            publishedTags: {
              hasEvery: normalizedTags,
            },
          },
          {
            AND: [
              {
                publishedTags: {
                  isEmpty: true,
                },
              },
              {
                tags: {
                  hasEvery: normalizedTags,
                },
              },
            ],
          },
        ],
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    return where;
  }

  /** The cover of a project on the hub; a 404 for a draft, null when it has no cover. */
  async publishedCoverUrl(projectId: number): Promise<string | null> {
    await this.requirePublished(projectId, { id: true });

    return this.projectService.coverUrl(projectId);
  }

  async fetchRelease(projectId: number): Promise<ReleaseProject> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
      },
      include: WITH_PEOPLE_AND_COUNTS,
    });

    if (!project) {
      throw new NotFoundException(`Project with ID ${projectId} not found`);
    }

    return hubFields(withCounts(project));
  }

  async fetchPublishedGames(): Promise<ReleaseProject[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        ...PUBLISHED,
      },
      include: WITH_PEOPLE_AND_COUNTS,
    });
    return projects.map((project) => hubFields(withCounts(project)));
  }

  async fetchPublishedGamesPaginated(
    page?: number,
    limit?: number,
    filters: PublishedProjectFilters = {},
    sort: ReleaseSort = 'fresh',
  ): Promise<PaginatedProjectsResult<ReleaseProject>> {
    const window = pageWindow(page, limit, DEFAULT_LIMIT);
    const where = this.buildPublishedGamesWhere(filters);

    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({
        where,
      }),
      this.prisma.project.findMany({
        where,
        include: WITH_PEOPLE_AND_COUNTS,
        orderBy: RELEASE_ORDER_BY[sort],
        skip: window.skip,
        take: window.take,
      }),
    ]);

    return {
      projects: projects.map((project) => hubFields(withCounts(project))),
      total,
      page: window.page,
      limit: window.limit,
    };
  }

  async countPublishedGames(filters: PublishedProjectFilters = {}): Promise<number> {
    return this.prisma.project.count({
      where: this.buildPublishedGamesWhere(filters),
    });
  }

  private async fetchReleasePage(
    where: Prisma.ProjectWhereInput,
    page: number | undefined,
    limit: number | undefined,
  ): Promise<ReleaseProject[]> {
    const { skip, take } = pageWindow(page, limit, DEFAULT_LIMIT);

    const projects = await this.prisma.project.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
      skip,
      take,
      include: WITH_PEOPLE_AND_COUNTS,
    });

    return projects.map((project) => hubFields(withCounts(project)));
  }

  async fetchPublishedGamesByUser(
    userId: number,
    page?: number,
    limit?: number,
    ownedOnly = false,
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      ownedOnly
        ? { ...PUBLISHED, userId }
        : {
            ...PUBLISHED,
            OR: [
              { userId },
              {
                collaborators: {
                  some: { id: userId },
                },
              },
            ],
          },
      page,
      limit,
    );
  }

  /** Published games this person collaborates on without owning them. */
  async fetchCollaborationsByUser(
    userId: number,
    page?: number,
    limit?: number,
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      {
        ...PUBLISHED,
        userId: { not: userId },
        collaborators: { some: { id: userId } },
      },
      page,
      limit,
    );
  }

  /** Published games other people forked from one of this person's. */
  async fetchRemixesOfUser(
    userId: number,
    page?: number,
    limit?: number,
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      {
        ...PUBLISHED,
        userId: { not: userId },
        forkedFrom: { userId },
      },
      page,
      limit,
    );
  }

  /**
   * The tags published games carry, most used first, optionally narrowed to those holding a
   * fragment.
   *
   * Raw SQL because the tags are an array column: counting them means unnesting it, which the
   * query builder has no shape for. A game that has never had its tags published falls back to
   * its draft ones, the same way the shelf filter does.
   */
  async fetchPublishedTags(
    fragment: string,
    limit: number,
  ): Promise<{ tag: string; count: number }[]> {
    return this.prisma.$queryRaw<{ tag: string; count: number }[]>`
      SELECT tag, COUNT(*)::int AS count
      FROM (
        SELECT unnest(
          CASE
            WHEN cardinality("publishedTags") > 0 THEN "publishedTags"
            ELSE "tags"
          END
        ) AS tag
        FROM "Project"
        WHERE "publishedAt" IS NOT NULL
      ) tags
      WHERE tag ILIKE ${`%${fragment}%`}
      GROUP BY tag
      ORDER BY count DESC, tag ASC
      LIMIT ${limit}
    `;
  }

  /** Totals over every published game the user owns. */
  async fetchUserTotals(
    userId: number,
  ): Promise<{ gameCount: number; totalPlays: number; totalLikes: number }> {
    const where: Prisma.ProjectWhereInput = { ...PUBLISHED, userId };
    const [gameCount, sums] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.aggregate({ where, _sum: { viewCount: true, likes: true } }),
    ]);

    return {
      gameCount,
      totalPlays: sums._sum.viewCount ?? 0,
      totalLikes: sums._sum.likes ?? 0,
    };
  }

  async fetchLikedPublishedGamesByUser(
    userId: number,
    page?: number,
    limit?: number,
  ): Promise<ReleaseProject[]> {
    return this.fetchReleasePage(
      {
        ...PUBLISHED,
        userLikes: {
          some: { userId },
        },
      },
      page,
      limit,
    );
  }

  /**
   * One view per reader per UTC day. The unique row is what decides; the counter follows it, so a
   * reload, or a loop of requests, moves nothing.
   */
  /**
   * Counts a play of a published game. A consenting browser counts once a day, by its account
   * when it is linked to one and by its visitor otherwise; a browser that declined counts every
   * play, keyed by nothing, within the limits of its address.
   */
  async registerReleaseView(
    projectId: number,
    viewer: { visitorId: string | null; address: string },
    now = new Date(),
  ): Promise<{ viewCount: number }> {
    const project = await this.requirePublished(projectId, {
      viewCount: true,
      updatedAt: true,
    });

    return this.prisma.$transaction(async (tx) => {
      const viewerKey = viewer.visitorId ? await viewerKeyOf(tx, viewer.visitorId) : null;

      if (viewerKey === null) {
        if (!this.keylessViews.admit(viewer.address, projectId, now.getTime())) {
          return { viewCount: project.viewCount };
        }
        return tx.project.update({
          where: { id: projectId },
          data: { viewCount: { increment: 1 }, ...keepEditTime(project) },
          select: { viewCount: true },
        });
      }

      const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const seenBefore = (await tx.releaseView.count({ where: { projectId, viewerKey } })) > 0;
      const created = await tx.releaseView.createMany({
        data: [{ projectId, viewerKey, day }],
        skipDuplicates: true,
      });
      if (created.count === 0) {
        return { viewCount: project.viewCount };
      }

      return tx.project.update({
        where: { id: projectId },
        data: {
          viewCount: { increment: 1 },
          ...(seenBefore ? {} : { uniquePlayers: { increment: 1 } }),
          ...keepEditTime(project),
        },
        select: { viewCount: true },
      });
    });
  }

  /** A like moves the counter only when its row was created, so a repeated request counts once. */
  async likeProject(projectId: number, userId: number): Promise<{ likes: number; liked: boolean }> {
    const project = await this.requirePublished(projectId, { likes: true, updatedAt: true });

    let updated: { likes: number };
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        await tx.like.create({ data: { userId, projectId } });

        return tx.project.update({
          where: { id: projectId },
          data: { likes: { increment: 1 }, ...keepEditTime(project) },
          select: { likes: true },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { likes: project.likes, liked: true };
      }
      throw error;
    }

    return { likes: updated.likes, liked: true };
  }

  /** Withdrawing stays possible after an unpublish, and moves the counter only when a row went. */
  async unlikeProject(
    projectId: number,
    userId: number,
  ): Promise<{ likes: number; liked: boolean }> {
    const project = await this.projectService.requireProject(projectId, {
      likes: true,
      updatedAt: true,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.like.deleteMany({
        where: { userId, projectId },
      });

      if (count === 0) {
        return null;
      }

      return tx.project.update({
        where: { id: projectId },
        data: { likes: { decrement: count }, ...keepEditTime(project) },
        select: { likes: true },
      });
    });

    if (!updated) {
      return { likes: project.likes, liked: false };
    }

    return { likes: updated.likes, liked: false };
  }

  async getLikeStatus(
    projectId: number,
    userId: number,
  ): Promise<{ likes: number; liked: boolean }> {
    const project = await this.projectService.requireProject(projectId, { likes: true });

    const existingLike = await this.prisma.like.findUnique({
      where: {
        userId_projectId: { userId, projectId },
      },
    });

    return { likes: project.likes, liked: !!existingLike };
  }

  async fork(sourceProjectId: number, userId: number): Promise<ProjectEx> {
    const sourceProject = await this.projectService.requireProject(sourceProjectId, {
      publishedAt: true,
      name: true,
      shortDesc: true,
      longDesc: true,
      tags: true,
      publishedName: true,
      publishedShortDesc: true,
      publishedLongDesc: true,
      publishedTags: true,
    });

    if (!sourceProject.publishedAt) {
      throw new BadRequestException('Only published projects can be forked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // A fork starts from what the hub shows of its source, not from the source's unpublished draft.
    const shown = hubFields(sourceProject);
    const newProject = await this.prisma.project.create({
      data: {
        name: `Fork of ${shown.name}`.slice(0, PROJECT_NAME_MAX_LENGTH),
        shortDesc: shown.shortDesc,
        longDesc: shown.longDesc,
        forkedFrom: { connect: { id: sourceProjectId } },
        creator: { connect: { id: userId } },
        collaborators: { connect: [{ id: userId }] },
      },
      include: WITH_PEOPLE,
    });

    try {
      await this.contentService.copyReleaseToSave(sourceProjectId, newProject.id);
    } catch (error) {
      // A fork whose content never arrived would sit in its owner's list as an empty project.
      await this.prisma.project.delete({ where: { id: newProject.id } });
      throw error;
    }

    // Only now is the fork there to stay: a failed copy above deletes it again.
    await this.prisma.$transaction((tx) =>
      this.projectService.recordProjectCreated(tx, newProject.id, userId),
    );

    try {
      await this.projectService.copyCover(sourceProjectId, newProject.id);
    } catch (error) {
      this.logger.warn(
        `Cover of project ${sourceProjectId} was not copied to its fork ${newProject.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    return newProject;
  }
}
