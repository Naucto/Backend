import { Logger } from '@nestjs/common';
import { HubSnapshot } from '@prisma/client';

import { uuidOf, uuidsOf as games } from '../../../test/uuid';
import { NO_RELEASE_ID } from '../../common/ids';
import { PrismaService } from '../../prisma/prisma.service';
import { CollectionsService } from '../collections/collections.service';
import { HubSnapshotService } from './hub-snapshot.service';
import { RecommendationsService } from './recommendations.service';

const NOW = new Date('2026-11-20T00:05:00Z');
const TODAY = new Date('2026-11-20T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** A published game as the catalogue query selects it. */
const catalogued = (id: number, overrides: object = {}): object => ({
  id: uuidOf(id),
  userId: uuidOf(100 + id),
  tags: ['draft-tag'],
  publishedTags: ['arcade'],
  viewCount: 10 * id,
  likes: 0,
  publishedAt: new Date('2026-11-01T00:00:00Z'),
  firstPublishedAt: new Date('2026-10-21T00:00:00Z'),
  _count: { forks: 0, comments: 0 },
  ...overrides,
});

const signal = (projectId: number, ageDays: number, plays: number): object => ({
  projectId: uuidOf(projectId),
  ageDays,
  plays,
  likes: 0,
  comments: 0,
  forks: 0,
});

describe('HubSnapshotService', () => {
  /** The snapshot rows the table holds, by the millisecond of their day. */
  let rows: Map<number, HubSnapshot>;

  const prisma = {
    project: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
    hubSnapshot: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const recommendations = { electGameOfTheWeek: jest.fn() };
  const collections = { listedWithGames: jest.fn() };
  let service: HubSnapshotService;

  beforeEach(() => {
    jest.resetAllMocks();
    rows = new Map();
    prisma.project.findMany.mockResolvedValue(
      Array.from({ length: 40 }, (_, index) => catalogued(index + 1)),
    );
    prisma.$queryRaw.mockResolvedValue([signal(3, 1, 20), signal(5, 1, 4), signal(5, 4, 4)]);
    prisma.hubSnapshot.findUnique.mockImplementation(
      async ({ where }: { where: { day: Date } }) => rows.get(where.day.getTime()) ?? null,
    );
    prisma.hubSnapshot.upsert.mockImplementation(async ({ create }: { create: HubSnapshot }) => {
      rows.set(create.day.getTime(), create);
      return create;
    });
    prisma.hubSnapshot.deleteMany.mockResolvedValue({ count: 0 });
    collections.listedWithGames.mockResolvedValue([]);

    service = new HubSnapshotService(
      prisma as unknown as PrismaService,
      recommendations as unknown as RecommendationsService,
      collections as unknown as CollectionsService,
    );
  });

  describe('refresh', () => {
    it("writes the day's row under its UTC day, with the time it was computed", async () => {
      await service.refresh(new Date('2026-11-20T23:59:00Z'));

      expect([...rows.keys()]).toEqual([TODAY.getTime()]);
      expect(prisma.hubSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { day: TODAY },
          create: expect.objectContaining({
            day: TODAY,
            computedAt: new Date('2026-11-20T23:59:00Z'),
          }),
        }),
      );
    });

    it('writes the same row when the day is computed again', async () => {
      await service.refresh(NOW);
      const first = rows.get(TODAY.getTime())?.payload;

      await service.refresh(new Date('2026-11-20T17:30:00Z'));

      expect(rows.size).toBe(1);
      expect(rows.get(TODAY.getTime())?.payload).toEqual(first);
      const [{ create, update }] = prisma.hubSnapshot.upsert.mock.calls[1] as [
        { create: HubSnapshot; update: Partial<HubSnapshot> },
      ];
      expect(update).toEqual({ computedAt: create.computedAt, payload: create.payload });
    });

    it('draws another hub the next day', async () => {
      await service.refresh(NOW);
      await service.refresh(new Date(NOW.getTime() + DAY_MS));

      const [today, tomorrow] = [...rows.values()].map(
        (row) => (row.payload as { popular: { games: string[] } }).popular.games,
      );
      expect(tomorrow?.slice(0, 24)).not.toEqual(today?.slice(0, 24));
    });

    it('reads only the seven whole days before the day it computes', async () => {
      await service.refresh(new Date('2026-11-20T18:00:00Z'));

      const [, ...bound] = prisma.$queryRaw.mock.calls[0] as [unknown, ...unknown[]];
      const days = bound.filter((value) => value instanceof Date);
      expect(new Set(days.map((value) => value.toISOString()))).toEqual(
        new Set(['2026-11-20T00:00:00.000Z', '2026-11-13T00:00:00.000Z']),
      );
    });

    it('files a game under its released tags, else under the tags of its draft', async () => {
      prisma.project.findMany.mockResolvedValue([
        catalogued(1),
        catalogued(2),
        catalogued(3, { publishedTags: [], tags: ['arcade'] }),
        catalogued(4, { publishedTags: [], tags: ['solo'] }),
      ]);

      await service.refresh(NOW);

      const payload = rows.get(TODAY.getTime())?.payload as { tags: object[] };
      expect(payload.tags).toEqual([expect.objectContaining({ tag: 'arcade', total: 3 })]);
    });

    it('counts a game as new from its first publication, not from its latest release', async () => {
      prisma.project.findMany.mockResolvedValue([
        catalogued(1),
        catalogued(2, {
          firstPublishedAt: new Date('2026-09-01T00:00:00Z'),
          publishedAt: new Date('2026-11-19T00:00:00Z'),
        }),
      ]);

      await service.refresh(NOW);

      const payload = rows.get(TODAY.getTime())?.payload as { rising: number[] };
      expect(payload.rising).toEqual(games(1));
    });

    it('hands the vote the trending games first, then the most played', async () => {
      prisma.project.findMany.mockResolvedValue([catalogued(1), catalogued(3), catalogued(5)]);

      await service.refresh(NOW);

      expect(recommendations.electGameOfTheWeek).toHaveBeenCalledWith(games(3, 5, 1), NOW);
    });

    it('puts forward the public collections holding three games on the hub', async () => {
      collections.listedWithGames.mockResolvedValue([
        { id: 'trio', ownerId: uuidOf(1), games: games(1, 2, 3) },
        { id: 'pair', ownerId: uuidOf(2), games: games(1, 2) },
      ]);

      await service.refresh(NOW);

      const payload = rows.get(TODAY.getTime())?.payload as { collections: object };
      expect(payload.collections).toEqual({ total: 2, ids: ['trio'] });
    });

    it('leaves out the anonymous plays counted outside a game', async () => {
      await service.refresh(NOW);

      const [, ...bound] = prisma.$queryRaw.mock.calls[0] as [unknown, ...unknown[]];
      expect(bound).toContain(NO_RELEASE_ID);
    });

    it('drops the snapshots older than sixty days', async () => {
      await service.refresh(NOW);

      expect(prisma.hubSnapshot.deleteMany).toHaveBeenCalledWith({
        where: { day: { lt: new Date('2026-09-21T00:00:00Z') } },
      });
    });

    it('halves the weight of the game that opened a shelf in the row of the day before', async () => {
      prisma.project.findMany.mockResolvedValue([catalogued(1), catalogued(2, { viewCount: 10 })]);
      const openers: unknown[] = [];

      for (let offset = 0; offset < 300; offset++) {
        await service.refresh(new Date(NOW.getTime() + offset * DAY_MS));
        const row = rows.get(TODAY.getTime() + offset * DAY_MS);
        openers.push((row?.payload as { popular: { games: string[] } }).popular.games[0]);
      }

      const repeats = openers.filter((opener, index) => index > 0 && opener === openers[index - 1]);
      expect(repeats.length).toBeGreaterThan(70);
      expect(repeats.length).toBeLessThan(130);
    });

    it('keeps the last snapshot and says so when the day cannot be computed', async () => {
      const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      prisma.project.findMany.mockRejectedValue(new Error('database away'));

      await expect(service.refresh(NOW)).resolves.toBeUndefined();

      expect(prisma.hubSnapshot.upsert).not.toHaveBeenCalled();
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('database away'));
      warned.mockRestore();
    });
  });

  describe('today', () => {
    it('answers the stored row of the day without computing anything', async () => {
      const payload = {
        popular: { total: 1, games: games(9) },
        collections: { total: 1, ids: ['one'] },
      };
      rows.set(TODAY.getTime(), { day: TODAY, computedAt: NOW, payload });

      await expect(service.today(new Date('2026-11-20T15:00:00Z'))).resolves.toEqual({
        day: '2026-11-20',
        payload,
      });
      expect(prisma.project.findMany).not.toHaveBeenCalled();
      expect(recommendations.electGameOfTheWeek).not.toHaveBeenCalled();
    });

    it('reads a row written before collections had a shelf as a day without any', async () => {
      const payload = { popular: { total: 1, games: games(9) } };
      rows.set(TODAY.getTime(), { day: TODAY, computedAt: NOW, payload });

      await expect(service.today(NOW)).resolves.toEqual({
        day: '2026-11-20',
        payload: { ...payload, collections: { total: 0, ids: [] } },
      });
    });

    it('computes a day that has no row yet, once for everyone asking meanwhile', async () => {
      const answers = await Promise.all([
        service.today(NOW),
        service.today(NOW),
        service.today(NOW),
      ]);

      expect(prisma.hubSnapshot.upsert).toHaveBeenCalledTimes(1);
      expect(recommendations.electGameOfTheWeek).toHaveBeenCalledTimes(1);
      expect(answers[0]?.day).toBe('2026-11-20');
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
    });

    it('computes again when the row of the day was removed', async () => {
      await service.today(NOW);
      rows.clear();

      await service.today(NOW);

      expect(prisma.hubSnapshot.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe('at start', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('computes the day when it has no snapshot', async () => {
      jest.setSystemTime(NOW);
      service.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(60_000);

      expect([...rows.keys()]).toEqual([TODAY.getTime()]);
    });

    it('leaves a day that has its snapshot alone', async () => {
      jest.setSystemTime(NOW);
      rows.set(TODAY.getTime(), { day: TODAY, computedAt: NOW, payload: {} });
      service.onApplicationBootstrap();

      await jest.advanceTimersByTimeAsync(60_000);

      expect(prisma.hubSnapshot.upsert).not.toHaveBeenCalled();
    });

    it('computes nothing once the server is shutting down', async () => {
      service.onApplicationBootstrap();
      service.onApplicationShutdown();

      await jest.advanceTimersByTimeAsync(60_000);

      expect(prisma.hubSnapshot.findUnique).not.toHaveBeenCalled();
    });
  });
});
