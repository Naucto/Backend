import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HubService } from '../project/hub.service';
import { ProjectService } from '../project/project.service';
import { RecommendationsService } from './recommendations.service';

describe('RecommendationsService', () => {
  let service: RecommendationsService;

  const prismaMock = {
    featuredRelease: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const projectServiceMock = {
    requireProject: jest.fn(),
  };

  const hubServiceMock = {
    fetchRelease: jest.fn(),
  };

  const notificationsServiceMock = {
    notifyBestEffort: jest.fn(),
  };

  const curator = { id: 9, username: 'admin' };
  const row = {
    id: 1,
    projectId: 42,
    featuredById: 9,
    note: 'pick',
    startsAt: new Date('2026-08-17T09:00:00Z'),
    endsAt: null,
    createdAt: new Date('2026-08-17T09:00:00Z'),
    featuredBy: curator,
  };
  const release = { id: 42, name: 'Moon Lander', publishedAt: new Date() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ProjectService, useValue: projectServiceMock },
        { provide: HubService, useValue: hubServiceMock },
        { provide: NotificationsService, useValue: notificationsServiceMock },
      ],
    }).compile();

    service = module.get<RecommendationsService>(RecommendationsService);
    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
        : Promise.all(arg as Array<Promise<unknown>>),
    );
  });

  describe('getCurrent', () => {
    it('returns null when nothing is featured', async () => {
      prismaMock.featuredRelease.findFirst.mockResolvedValue(null);

      await expect(service.getCurrent()).resolves.toBeNull();
      expect(hubServiceMock.fetchRelease).not.toHaveBeenCalled();
    });

    it('returns the current entry with its release', async () => {
      prismaMock.featuredRelease.findFirst.mockResolvedValue(row);
      hubServiceMock.fetchRelease.mockResolvedValue(release);

      await expect(service.getCurrent()).resolves.toEqual({
        id: 1,
        projectId: 42,
        note: 'pick',
        startsAt: row.startsAt,
        endsAt: null,
        featuredBy: curator,
        project: release,
      });
    });

    it('retires the entry when the project was unpublished', async () => {
      prismaMock.featuredRelease.findFirst.mockResolvedValue(row);
      hubServiceMock.fetchRelease.mockResolvedValue({
        ...release,
        publishedAt: null,
      });
      prismaMock.featuredRelease.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.getCurrent()).resolves.toBeNull();
      expect(prismaMock.featuredRelease.updateMany).toHaveBeenCalledWith({
        where: { id: 1, endsAt: null },
        data: { endsAt: expect.any(Date) },
      });
    });
  });

  describe('setFeatured', () => {
    it('rejects unknown projects', async () => {
      projectServiceMock.requireProject.mockRejectedValue(new NotFoundException());

      await expect(service.setFeatured(1, 9)).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.featuredRelease.create).not.toHaveBeenCalled();
    });

    it('rejects unpublished projects', async () => {
      projectServiceMock.requireProject.mockResolvedValue({
        id: 1,
        publishedAt: null,
        userId: 3,
        publishedName: null,
        name: 'Draft',
      });

      await expect(service.setFeatured(1, 9)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ends the previous pick, creates the new one and notifies the creator', async () => {
      projectServiceMock.requireProject.mockResolvedValue({
        id: 42,
        publishedAt: new Date(),
        userId: 3,
        publishedName: 'Moon Lander',
        name: 'moon',
      });
      prismaMock.featuredRelease.updateMany.mockResolvedValue({ count: 1 });
      prismaMock.featuredRelease.create.mockResolvedValue(row);
      hubServiceMock.fetchRelease.mockResolvedValue(release);
      notificationsServiceMock.notifyBestEffort.mockResolvedValue({});

      const result = await service.setFeatured(42, 9, 'pick');

      expect(prismaMock.featuredRelease.updateMany).toHaveBeenCalledWith({
        where: { endsAt: null },
        data: { endsAt: expect.any(Date) },
      });
      expect(prismaMock.featuredRelease.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 42,
            featuredById: 9,
            note: 'pick',
          }),
        }),
      );
      expect(notificationsServiceMock.notifyBestEffort).toHaveBeenCalledWith({
        userId: 3,
        title: 'Your game is featured!',
        message: 'Moon Lander is the game of the week on the Naucto hub.',
        type: 'INFO',
        kind: 'FEATURED',
        data: { projectId: 42 },
      });
      expect(result.project).toEqual(release);
      expect(result.projectId).toBe(42);
    });
  });

  describe('clearFeatured', () => {
    it('ends whatever pick is current', async () => {
      prismaMock.featuredRelease.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.clearFeatured();

      expect(prismaMock.featuredRelease.updateMany).toHaveBeenCalledWith({
        where: { endsAt: null },
        data: { endsAt: expect.any(Date) },
      });
    });
  });

  describe('getHistory', () => {
    it('paginates newest first and uses the published name', async () => {
      prismaMock.featuredRelease.count.mockResolvedValue(1);
      prismaMock.featuredRelease.findMany.mockResolvedValue([
        {
          ...row,
          endsAt: new Date('2026-08-20T09:00:00Z'),
          project: { id: 42, name: 'moon', publishedName: 'Moon Lander' },
        },
      ]);

      const result = await service.getHistory(2, 500);

      expect(prismaMock.featuredRelease.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 100 }),
      );
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: 1,
            project: { id: 42, name: 'Moon Lander' },
          }),
        ],
        total: 1,
        page: 2,
        limit: 100,
      });
    });

    it('falls back to defaults on invalid pagination', async () => {
      prismaMock.featuredRelease.count.mockResolvedValue(0);
      prismaMock.featuredRelease.findMany.mockResolvedValue([]);

      const result = await service.getHistory(0, -1);

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });
});
