import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { TestingModule } from '@nestjs/testing';
import { Prisma, ProjectStatus } from '@prisma/client';
import { Readable } from 'stream';

import { withEnv } from '../../../test/env';
import { draft, knownError, ProjectMocks, released } from '../../../test/project-mocks';
import { PrismaService } from '../../prisma/prisma.service';
import { EdgeService } from '../s3/edge.service';
import { S3Service } from '../s3/s3.service';
import { PROJECT_NAME_MAX_LENGTH } from './dto/project-field-limits';
import { HubService } from './hub.service';
import { ProjectService } from './project.service';
import { ProjectContentService } from './project-content.service';
import { COLLABORATOR_SELECT, CREATOR_SELECT } from './project-select';
import { viewerKeyOf } from './viewer-key';

describe('HubService', () => {
  let service: HubService;

  const mocks = new ProjectMocks();
  const { prismaMock, s3ServiceMock, edgeMock } = mocks;

  beforeEach(async () => {
    withEnv({
      JWT_SECRET: 'jwt-secret',
      S3_MAX_AUTO_HISTORY_VERSION: '5',
      S3_AUTO_HISTORY_DELAY: '10',
      S3_MAX_CHECKPOINTS: '5',
    });

    const module: TestingModule = await mocks.compile();
    service = module.get<HubService>(HubService);

    jest.clearAllMocks();
  });

  describe('configuration', () => {
    const RELEVANT_KEYS = [
      'S3_MAX_AUTO_HISTORY_VERSION',
      'S3_AUTO_HISTORY_DELAY',
      'S3_MAX_CHECKPOINTS',
      'VIEW_HASH_SECRET',
      'JWT_SECRET',
    ] as const;

    const serviceWith = (
      env: Partial<Record<(typeof RELEVANT_KEYS)[number], string>>,
    ): HubService => {
      withEnv(Object.fromEntries(RELEVANT_KEYS.map((key) => [key, env[key]])));

      const projectService = new ProjectService(
        prismaMock as unknown as PrismaService,
        s3ServiceMock as unknown as S3Service,
        edgeMock as unknown as EdgeService,
        {} as ModuleRef,
      );
      const contentService = new ProjectContentService(
        prismaMock as unknown as PrismaService,
        s3ServiceMock as unknown as S3Service,
        edgeMock as unknown as EdgeService,
        projectService,
      );

      return new HubService(prismaMock as unknown as PrismaService, projectService, contentService);
    };
    const blank = {
      S3_MAX_AUTO_HISTORY_VERSION: '',
      S3_AUTO_HISTORY_DELAY: '',
      S3_MAX_CHECKPOINTS: '',
      VIEW_HASH_SECRET: '',
      JWT_SECRET: 'jwt-secret',
    };

    it('keys anonymous viewers with the JWT secret when no view secret is set', async () => {
      prismaMock.project.findFirst.mockResolvedValue({
        id: 1,
        viewCount: 0,
        updatedAt: new Date(),
      });
      prismaMock.releaseView.count.mockResolvedValue(0);
      prismaMock.releaseView.create.mockResolvedValue({});
      prismaMock.project.update.mockResolvedValue({ viewCount: 1 });

      await serviceWith(blank).registerReleaseView(1, {
        userId: null,
        ip: '203.0.113.9',
      });

      expect(prismaMock.releaseView.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          viewerKey: viewerKeyOf(null, '203.0.113.9', 'jwt-secret'),
        }),
      });
    });

    it('refuses to start without a secret to key viewers with', () => {
      expect(() => serviceWith({})).toThrow();
    });
  });

  describe('likeProject / unlikeProject', () => {
    const stored = { likes: 4, updatedAt: new Date('2026-01-01T00:00:00Z') };

    beforeEach(() => {
      prismaMock.project.findFirst.mockResolvedValue(stored);
      prismaMock.project.findUnique.mockResolvedValue(stored);
    });

    it('moves the counter by one for a first like, without touching the edit time, on one transaction', async () => {
      prismaMock.tx.like.create.mockResolvedValue({});
      prismaMock.tx.project.update.mockResolvedValue({ likes: 5 });

      await expect(service.likeProject(1, 7)).resolves.toEqual({
        likes: 5,
        liked: true,
      });

      expect(prismaMock.tx.like.create).toHaveBeenCalledWith({
        data: { userId: 7, projectId: 1 },
      });
      expect(prismaMock.tx.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { likes: { increment: 1 }, updatedAt: stored.updatedAt },
        }),
      );
      expect(prismaMock.like.create).not.toHaveBeenCalled();
      expect(prismaMock.project.update).not.toHaveBeenCalled();
    });

    it('moves nothing when the like already exists', async () => {
      prismaMock.tx.like.create.mockRejectedValue(knownError('P2002'));

      await expect(service.likeProject(1, 7)).resolves.toEqual({
        likes: 4,
        liked: true,
      });

      expect(prismaMock.tx.project.update).not.toHaveBeenCalled();
    });

    it('counts both of two likes that land together', async () => {
      const liked = new Set<number>();
      let likes = 0;
      let releaseFirstWrite = (): void => undefined;
      const firstWriteHeld = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      let writes = 0;
      prismaMock.project.findFirst.mockImplementation(async () => ({
        likes,
        updatedAt: stored.updatedAt,
      }));
      prismaMock.tx.like.create.mockImplementation(
        async ({ data }: { data: { userId: number } }) => {
          liked.add(data.userId);
        },
      );
      prismaMock.tx.project.update.mockImplementation(
        async ({ data }: { data: { likes: { increment: number } } }) => {
          if (writes++ === 0) {
            await firstWriteHeld;
          }
          likes += data.likes.increment;
          return { likes };
        },
      );

      const first = service.likeProject(1, 7);
      await new Promise((resolve) => setImmediate(resolve));
      await service.likeProject(1, 8);
      releaseFirstWrite();
      await first;

      expect(likes).toBe(liked.size);
    });

    it('refuses a like on a project the hub does not carry', async () => {
      prismaMock.project.findFirst.mockResolvedValue(null);

      await expect(service.likeProject(999, 7)).rejects.toBeInstanceOf(NotFoundException);

      expect(prismaMock.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 999, publishedAt: { not: null } },
        }),
      );
      expect(prismaMock.tx.like.create).not.toHaveBeenCalled();
    });

    it('takes a like back, and the count with it, on one transaction', async () => {
      prismaMock.tx.like.deleteMany.mockResolvedValue({ count: 1 });
      prismaMock.tx.project.update.mockResolvedValue({ likes: 3 });

      await expect(service.unlikeProject(1, 7)).resolves.toEqual({
        likes: 3,
        liked: false,
      });

      expect(prismaMock.tx.like.deleteMany).toHaveBeenCalledWith({
        where: { userId: 7, projectId: 1 },
      });
      expect(prismaMock.tx.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { likes: { decrement: 1 }, updatedAt: stored.updatedAt },
        }),
      );
      expect(prismaMock.like.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.project.update).not.toHaveBeenCalled();
    });

    it('moves nothing when there was no like to take back', async () => {
      prismaMock.tx.like.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.unlikeProject(1, 7)).resolves.toEqual({
        likes: 4,
        liked: false,
      });

      expect(prismaMock.tx.project.update).not.toHaveBeenCalled();
    });
  });

  describe('getLikeStatus', () => {
    it('reports the count and whether this reader is in it', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ likes: 3 });
      prismaMock.like.findUnique.mockResolvedValue({ id: 10 });

      await expect(service.getLikeStatus(1, 7)).resolves.toEqual({
        likes: 3,
        liked: true,
      });
    });

    it('rejects a project that does not exist', async () => {
      prismaMock.project.findUnique.mockResolvedValue(null);

      await expect(service.getLikeStatus(999, 7)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('fetchRelease', () => {
    it('names the people on a project without their addresses', async () => {
      prismaMock.project.findFirst.mockResolvedValue({
        ...draft,
        _count: { forks: 0, comments: 0 },
      });

      const result = await service.fetchRelease(1);

      expect(result.creator).not.toHaveProperty('email');
      for (const collaborator of result.collaborators) {
        expect(collaborator).not.toHaveProperty('email');
      }
    });

    it('shows the draft of a project whose snapshot was never taken', async () => {
      prismaMock.project.findFirst.mockResolvedValue({
        ...draft,
        _count: { forks: 0, comments: 0 },
      });

      await expect(service.fetchRelease(1)).resolves.toMatchObject({
        name: 'Project A',
        shortDesc: 'Short A',
        longDesc: 'Long A',
        tags: ['Action'],
      });
    });

    it('keeps a summary published empty, whatever the draft says since', async () => {
      prismaMock.project.findFirst.mockResolvedValue({
        ...released,
        publishedShortDesc: '',
        shortDesc: 'Typed after the release',
        _count: { forks: 0, comments: 0 },
      });

      const result = await service.fetchRelease(2);

      expect(result.shortDesc).toBe('');
    });
  });

  describe('publishedCoverUrl', () => {
    it('rejects a project the hub does not carry', async () => {
      prismaMock.project.findFirst.mockResolvedValue(null);

      await expect(service.publishedCoverUrl(1)).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.project.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1, publishedAt: { not: null } } }),
      );
    });
  });

  describe('registerReleaseView', () => {
    const viewer = { userId: 7, ip: '203.0.113.9' };
    const updatedAt = new Date('2026-01-01T00:00:00Z');

    beforeEach(() => {
      prismaMock.project.findFirst.mockResolvedValue({
        id: 1,
        viewCount: 10,
        updatedAt,
      });
      prismaMock.project.update.mockResolvedValue({ viewCount: 11 });
    });

    it("counts a reader's first view of the day, and a first reader twice over", async () => {
      prismaMock.releaseView.count.mockResolvedValue(0);
      prismaMock.releaseView.create.mockResolvedValue({});

      await expect(service.registerReleaseView(1, viewer)).resolves.toEqual({
        viewCount: 11,
      });

      expect(prismaMock.releaseView.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ projectId: 1, viewerKey: 'u:7' }),
      });
      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            viewCount: { increment: 1 },
            uniquePlayers: { increment: 1 },
            updatedAt,
          },
        }),
      );
    });

    it('moves nothing on a second view the same day', async () => {
      prismaMock.releaseView.count.mockResolvedValue(1);
      prismaMock.releaseView.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('taken', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.registerReleaseView(1, viewer)).resolves.toEqual({
        viewCount: 10,
      });

      expect(prismaMock.project.update).not.toHaveBeenCalled();
    });

    it("counts a returning reader's view without counting them as new", async () => {
      prismaMock.releaseView.count.mockResolvedValue(1);
      prismaMock.releaseView.create.mockResolvedValue({});

      await service.registerReleaseView(1, viewer);

      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { viewCount: { increment: 1 }, updatedAt },
        }),
      );
    });

    it('keys an anonymous reader by address, apart from any account', async () => {
      prismaMock.releaseView.count.mockResolvedValue(0);
      prismaMock.releaseView.create.mockResolvedValue({});

      await service.registerReleaseView(1, { userId: null, ip: '203.0.113.9' });

      const key = prismaMock.releaseView.create.mock.calls[0]![0].data.viewerKey as string;
      expect(key).toMatch(/^ip:/);
      expect(key).not.toContain('203.0.113.9');
    });

    it('counts nothing for a project the hub does not carry', async () => {
      prismaMock.project.findFirst.mockResolvedValue(null);

      await expect(service.registerReleaseView(1, viewer)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prismaMock.releaseView.create).not.toHaveBeenCalled();
    });
  });

  describe('fetchPublishedGamesPaginated', () => {
    const publishedProject = {
      ...released,
      _count: {
        comments: 3,
        forks: 5,
      },
    };

    it('should return paginated published projects with counts', async () => {
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.project.findMany.mockResolvedValue([publishedProject]);

      const result = await service.fetchPublishedGamesPaginated(2, 1);

      expect(prismaMock.project.count).toHaveBeenCalledWith({
        where: { publishedAt: { not: null } },
      });
      expect(prismaMock.project.findMany).toHaveBeenCalledWith({
        where: { publishedAt: { not: null } },
        include: {
          collaborators: { select: COLLABORATOR_SELECT },
          creator: { select: CREATOR_SELECT },
          _count: {
            select: {
              forks: true,
              comments: { where: { deleted: false } },
            },
          },
        },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: 1,
        take: 1,
      });
      expect(result).toEqual({
        projects: [
          expect.objectContaining({
            id: publishedProject.id,
            name: publishedProject.publishedName,
            commentCount: 3,
            forkCount: 5,
          }),
        ],
        total: 1,
        page: 2,
        limit: 1,
      });
    });

    it('should normalize invalid page and cap large limits', async () => {
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.project.findMany.mockResolvedValue([publishedProject]);

      const result = await service.fetchPublishedGamesPaginated(0, 500);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 100,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.limit).toBe(100);
    });

    it('should order by the requested shelf sort', async () => {
      prismaMock.project.count.mockResolvedValue(1);
      prismaMock.project.findMany.mockResolvedValue([publishedProject]);

      await service.fetchPublishedGamesPaginated(1, 10, {}, 'popular');

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ viewCount: 'desc' }, { publishedAt: 'desc' }],
        }),
      );
    });

    it('should apply the search filter to both the page and its total', async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchPublishedGamesPaginated(1, 10, { search: 'snake' });

      const where = prismaMock.project.count.mock.calls[0]![0]!.where;
      expect(where).toEqual(
        expect.objectContaining({ publishedAt: { not: null }, AND: expect.any(Array) }),
      );
      // The same filter has to reach findMany, or page 1 of a search shows unfiltered games.
      expect(prismaMock.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    });

    it("should look for a search term beyond the game's name", async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchPublishedGamesPaginated(1, 10, { search: 'snake' });

      const where = prismaMock.project.count.mock.calls[0]![0]!.where as {
        AND: { OR?: unknown[] }[];
      };
      const or = where.AND.find((clause) => clause.OR)!.OR!;

      expect(or).toEqual(
        expect.arrayContaining([
          { publishedShortDesc: { contains: 'snake', mode: 'insensitive' } },
          { publishedTags: { hasSome: ['snake', 'snake'] } },
          { creator: { username: { contains: 'snake', mode: 'insensitive' } } },
        ]),
      );
    });

    it('should keep a release window to games published inside it', async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.findMany.mockResolvedValue([]);
      const week = 7 * 24 * 60 * 60 * 1000;
      const asked = Date.now();

      await service.fetchPublishedGamesPaginated(1, 10, { releaseWindow: '7d' });

      const where = prismaMock.project.count.mock.calls[0]![0]!.where as {
        AND: [{ publishedAt: { gte: Date } }];
      };
      const threshold = where.AND[0].publishedAt.gte.getTime();
      expect(threshold).toBeGreaterThanOrEqual(asked - week);
      expect(threshold).toBeLessThanOrEqual(Date.now() - week);
    });

    it('should not narrow by date when every release is asked for', async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchPublishedGamesPaginated(1, 10, { releaseWindow: 'all' });

      expect(prismaMock.project.count).toHaveBeenCalledWith({
        where: { publishedAt: { not: null } },
      });
    });

    it('should match a tag on the published tags, or on the draft ones of a game that has none', async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchPublishedGamesPaginated(1, 10, {
        tags: [' Action ', 'action', ''],
      });

      expect(prismaMock.project.count).toHaveBeenCalledWith({
        where: {
          publishedAt: { not: null },
          AND: [
            {
              OR: [
                { publishedTags: { hasEvery: ['Action'] } },
                {
                  AND: [{ publishedTags: { isEmpty: true } }, { tags: { hasEvery: ['Action'] } }],
                },
              ],
            },
          ],
        },
      });
    });
  });

  describe('profile shelves', () => {
    it('should exclude games the person owns from their collaborations', async () => {
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchCollaborationsByUser(7);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            publishedAt: { not: null },
            userId: { not: 7 },
            collaborators: { some: { id: 7 } },
          },
        }),
      );
    });

    it('should list remixes by the owner of what they were forked from', async () => {
      prismaMock.project.findMany.mockResolvedValue([]);

      await service.fetchRemixesOfUser(7);

      expect(prismaMock.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            publishedAt: { not: null },
            userId: { not: 7 },
            forkedFrom: { userId: 7 },
          },
        }),
      );
    });

    it('should sum plays and likes over owned published games', async () => {
      prismaMock.project.count.mockResolvedValue(3);
      prismaMock.project.aggregate.mockResolvedValue({
        _sum: { viewCount: 1240, likes: 318 },
      });

      await expect(service.fetchUserTotals(7)).resolves.toEqual({
        gameCount: 3,
        totalPlays: 1240,
        totalLikes: 318,
      });
    });

    it('should report zeroes when a person has published nothing', async () => {
      prismaMock.project.count.mockResolvedValue(0);
      prismaMock.project.aggregate.mockResolvedValue({
        _sum: { viewCount: null, likes: null },
      });

      await expect(service.fetchUserTotals(7)).resolves.toEqual({
        gameCount: 0,
        totalPlays: 0,
        totalLikes: 0,
      });
    });
  });

  describe('fork', () => {
    const source = {
      ...released,
      name: 'Unreleased rename',
      shortDesc: 'Draft blurb',
      longDesc: 'Draft text',
      publishedName: 'Snake',
      publishedShortDesc: 'Public blurb',
      publishedLongDesc: 'Public text',
    };
    const forked = { ...draft, id: 50 };

    beforeEach(() => {
      prismaMock.project.findUnique.mockResolvedValue(source);
      prismaMock.user.findUnique.mockResolvedValue({ id: 9 });
      prismaMock.project.create.mockResolvedValue(forked);
      prismaMock.project.update.mockResolvedValue({});
      prismaMock.project.delete.mockResolvedValue({});
      s3ServiceMock.downloadFile.mockImplementation(async () => ({
        body: Readable.from(['blob']),
        contentType: 'application/octet-stream',
        contentLength: 4,
      }));
      s3ServiceMock.uploadFile.mockResolvedValue(undefined);
      s3ServiceMock.setObjectPublicRead.mockResolvedValue(undefined);
      s3ServiceMock.fileExists.mockResolvedValue(false);
    });

    it('refuses to fork a project the hub does not carry, whatever its status says', async () => {
      prismaMock.project.findUnique.mockResolvedValue({
        ...draft,
        status: ProjectStatus.COMPLETED,
        publishedAt: null,
      });

      await expect(service.fork(1, 2)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('starts the fork from the release of its source', async () => {
      await expect(service.fork(2, 9)).resolves.toBe(forked);

      expect(s3ServiceMock.downloadFile).toHaveBeenCalledWith({
        key: 'release/2',
      });
      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({
          keyName: expect.stringMatching(/^save\/50\/\d+$/),
        }),
      );
    });

    it('describes the fork as the hub shows its source, not as the draft reads', async () => {
      await service.fork(2, 9);

      expect(prismaMock.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Fork of Snake',
            shortDesc: 'Public blurb',
            longDesc: 'Public text',
          }),
        }),
      );
    });

    it("keeps the fork's name within the limit a later update enforces", async () => {
      const longest = 'N'.repeat(PROJECT_NAME_MAX_LENGTH);
      prismaMock.project.findUnique.mockResolvedValue({
        ...source,
        name: longest,
        publishedName: longest,
      });

      await service.fork(2, 9);

      const { name } = prismaMock.project.create.mock.calls[0]![0].data as {
        name: string;
      };
      expect(name).toHaveLength(PROJECT_NAME_MAX_LENGTH);
    });

    it('leaves no project behind when the release cannot be copied', async () => {
      const failure = new Error('store down');
      s3ServiceMock.uploadFile.mockRejectedValue(failure);

      await expect(service.fork(2, 9)).rejects.toBe(failure);

      expect(prismaMock.project.delete).toHaveBeenCalledWith({
        where: { id: 50 },
      });
    });

    it('copies the cover and records where it landed', async () => {
      s3ServiceMock.fileExists.mockResolvedValue(true);

      await service.fork(2, 9);

      expect(s3ServiceMock.uploadFile).toHaveBeenCalledWith(
        expect.objectContaining({ keyName: 'projects/50/image' }),
      );
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 50 },
        data: { iconUrl: 'https://cdn.test/projects/50/image' },
      });
    });

    it('still forks, and says so in the log, when the cover cannot be copied', async () => {
      const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      s3ServiceMock.fileExists.mockRejectedValue(new Error('store down'));

      await expect(service.fork(2, 9)).resolves.toBe(forked);

      expect(warned).toHaveBeenCalledTimes(1);
      warned.mockRestore();
    });
  });
});
