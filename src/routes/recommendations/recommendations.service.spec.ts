import { Test, TestingModule } from '@nestjs/testing';

import { uuidOf, uuidsOf as ids } from '../../../test/uuid';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { HubService } from '../project/hub.service';
import { ProjectService } from '../project/project.service';
import { RecommendationsService, WINNER_REST_WEEKS } from './recommendations.service';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A Monday, five minutes into the UTC day: when the hub computes its week. */
const MONDAY = new Date('2026-11-16T00:05:00Z');
const weeksLater = (weeks: number): Date => new Date(MONDAY.getTime() + weeks * WEEK_MS);

/** The games a ranking may name, each with an owner and a name of its own. */
const GAMES = new Map(
  Array.from({ length: 20 }, (_, index) => index + 1).map((number) => [
    uuidOf(number),
    { userId: uuidOf(100 + number), name: `draft-${number}`, publishedName: `Game ${number}` },
  ]),
);

interface Pick {
  id: string;
  projectId: string;
  startsAt: Date;
  endsAt: Date | null;
}

describe('RecommendationsService', () => {
  let service: RecommendationsService;

  /** The picks the table holds, read and written by the mocks below as Prisma would. */
  let picks: Pick[];

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
    fetchReleasesByIds: jest.fn(),
  };

  const notificationsServiceMock = {
    notifyBestEffort: jest.fn(),
  };

  const curator = { id: uuidOf(9), username: 'admin' };
  const row = {
    id: uuidOf(1),
    projectId: uuidOf(42),
    featuredById: uuidOf(9),
    note: 'pick',
    startsAt: new Date('2026-08-17T09:00:00Z'),
    endsAt: null,
    createdAt: new Date('2026-08-17T09:00:00Z'),
    featuredBy: curator,
  };
  const release = { id: uuidOf(42), name: 'Moon Lander', publishedAt: new Date() };

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
    jest.resetAllMocks();
    prismaMock.$transaction.mockImplementation((arg: unknown) =>
      typeof arg === 'function'
        ? (arg as (tx: typeof prismaMock) => Promise<unknown>)(prismaMock)
        : Promise.all(arg as Array<Promise<unknown>>),
    );

    picks = [];
    prismaMock.featuredRelease.findMany.mockImplementation(
      async ({ where }: { where: { OR: [{ startsAt: { gte: Date } }, { endsAt: null }] } }) =>
        picks.filter((pick) => pick.startsAt >= where.OR[0].startsAt.gte || pick.endsAt === null),
    );
    prismaMock.featuredRelease.updateMany.mockImplementation(
      async ({ data }: { data: { endsAt: Date } }) => {
        const running = picks.filter((pick) => pick.endsAt === null);
        running.forEach((pick) => (pick.endsAt = data.endsAt));
        return { count: running.length };
      },
    );
    prismaMock.featuredRelease.create.mockImplementation(
      async ({ data }: { data: { projectId: string; startsAt: Date } }) => {
        const pick = { id: uuidOf(picks.length + 1), ...data, endsAt: null };
        picks.push(pick);
        return pick;
      },
    );
    projectServiceMock.requireProject.mockImplementation(async (id: string) => GAMES.get(id));
  });

  describe('getCurrent', () => {
    it('returns null when nothing is featured', async () => {
      prismaMock.featuredRelease.findFirst.mockResolvedValue(null);

      await expect(service.getCurrent()).resolves.toBeNull();
      expect(hubServiceMock.fetchReleasesByIds).not.toHaveBeenCalled();
    });

    it('returns the current entry with its release', async () => {
      prismaMock.featuredRelease.findFirst.mockResolvedValue(row);
      hubServiceMock.fetchReleasesByIds.mockResolvedValue([release]);

      await expect(service.getCurrent()).resolves.toEqual({
        id: uuidOf(1),
        projectId: uuidOf(42),
        note: 'pick',
        startsAt: row.startsAt,
        endsAt: null,
        featuredBy: curator,
        project: release,
      });
      expect(hubServiceMock.fetchReleasesByIds).toHaveBeenCalledWith([uuidOf(42)]);
      expect(prismaMock.featuredRelease.updateMany).not.toHaveBeenCalled();
    });

    it('answers none for a pick whose game left the hub, and ends it only when the game is withheld', async () => {
      prismaMock.featuredRelease.findFirst.mockResolvedValue(row);
      hubServiceMock.fetchReleasesByIds.mockResolvedValue([]);

      await expect(service.getCurrent()).resolves.toBeNull();
      expect(prismaMock.featuredRelease.updateMany).toHaveBeenCalledWith({
        where: { id: uuidOf(1), project: { hiddenAt: { not: null } } },
        data: { endsAt: expect.any(Date) },
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('electGameOfTheWeek', () => {
    it('picks the best game, ends the pick before it and tells its creator', async () => {
      picks.push({ id: uuidOf(1), projectId: uuidOf(7), startsAt: weeksLater(-1), endsAt: null });

      await service.electGameOfTheWeek(ids(3, 5, 8), MONDAY);

      expect(picks).toEqual([
        { id: uuidOf(1), projectId: uuidOf(7), startsAt: weeksLater(-1), endsAt: MONDAY },
        { id: uuidOf(2), projectId: uuidOf(3), startsAt: MONDAY, endsAt: null },
      ]);
      expect(prismaMock.featuredRelease.create).toHaveBeenCalledWith({
        data: { projectId: uuidOf(3), startsAt: MONDAY },
      });
      expect(notificationsServiceMock.notifyBestEffort).toHaveBeenCalledWith({
        userId: uuidOf(103),
        title: 'Your game is featured!',
        message: 'Game 3 is the game of the week on the Naucto hub.',
        type: 'INFO',
        kind: 'FEATURED',
        data: { projectId: uuidOf(3) },
      });
    });

    it('picks once a week, however often it is asked', async () => {
      await service.electGameOfTheWeek(ids(3, 5, 8), MONDAY);
      await service.electGameOfTheWeek(ids(5, 3, 8), new Date('2026-11-18T14:00:00Z'));
      await service.electGameOfTheWeek(ids(8, 5, 3), new Date('2026-11-22T23:59:59Z'));

      expect(picks.map((pick) => pick.projectId)).toEqual(ids(3));
      expect(notificationsServiceMock.notifyBestEffort).toHaveBeenCalledTimes(1);
    });

    it('picks later in the week when the server missed Monday', async () => {
      const thursday = new Date('2026-11-19T10:00:00Z');

      await service.electGameOfTheWeek(ids(3), thursday);
      await service.electGameOfTheWeek(ids(5, 3), weeksLater(1));

      expect(picks.map(({ projectId, startsAt }) => [projectId, startsAt])).toEqual([
        [uuidOf(3), thursday],
        [uuidOf(5), weeksLater(1)],
      ]);
    });

    it('never picks a game again within eight weeks, even when it stays the best', async () => {
      const ranking = Array.from({ length: WINNER_REST_WEEKS + 2 }, (_, index) =>
        uuidOf(index + 1),
      );

      for (let week = 0; week < 40; week++) {
        await service.electGameOfTheWeek(ranking, weeksLater(week));
      }

      const winners = picks.map((pick) => pick.projectId);
      expect(winners).toHaveLength(40);
      winners.forEach((winner, week) => {
        expect(winners.slice(Math.max(0, week - WINNER_REST_WEEKS), week)).not.toContain(winner);
      });
      // The best game is back as soon as its rest is over, not later.
      expect(winners[WINNER_REST_WEEKS + 1]).toBe(uuidOf(1));
    });

    it('leaves the week without a pick rather than repeat one, and tries again the next day', async () => {
      await service.electGameOfTheWeek(ids(3), MONDAY);

      await service.electGameOfTheWeek(ids(3), weeksLater(1));

      expect(picks).toEqual([
        { id: uuidOf(1), projectId: uuidOf(3), startsAt: MONDAY, endsAt: weeksLater(1) },
      ]);
      expect(notificationsServiceMock.notifyBestEffort).toHaveBeenCalledTimes(1);

      const tuesday = new Date(weeksLater(1).getTime() + 24 * 60 * 60 * 1000);
      await service.electGameOfTheWeek(ids(3, 4), tuesday);

      expect(picks[picks.length - 1]).toEqual({
        id: uuidOf(2),
        projectId: uuidOf(4),
        startsAt: tuesday,
        endsAt: null,
      });
    });

    it('does not pick again a game a curator left running for months', async () => {
      picks.push({ id: uuidOf(1), projectId: uuidOf(3), startsAt: weeksLater(-30), endsAt: null });

      await service.electGameOfTheWeek(ids(3, 4), MONDAY);

      expect(picks[picks.length - 1]).toMatchObject({ projectId: uuidOf(4), endsAt: null });
    });
  });

  describe('getHistory', () => {
    it('paginates newest first and uses the published name', async () => {
      prismaMock.featuredRelease.count.mockResolvedValue(1);
      prismaMock.featuredRelease.findMany.mockResolvedValue([
        {
          ...row,
          endsAt: new Date('2026-08-20T09:00:00Z'),
          project: { id: uuidOf(42), name: 'moon', publishedName: 'Moon Lander' },
        },
      ]);

      const result = await service.getHistory(2, 500);

      expect(prismaMock.featuredRelease.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 100 }),
      );
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            id: uuidOf(1),
            project: { id: uuidOf(42), name: 'Moon Lander' },
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
