import { PrismaClient } from '@prisma/client';

import { planSignals, seedHubSignals } from '../prisma/seed-dev-hub';

const PEOPLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const NOW = new Date('2026-11-20T15:30:00Z');
const TODAY = new Date('2026-11-20T00:00:00Z');
const DAY_MS = 86_400_000;

describe('seed:dev hub signals', () => {
  describe('planSignals', () => {
    it('plans the same thing for the same game on every run', () => {
      expect(planSignals(4, 2, PEOPLE)).toEqual(planSignals(4, 2, PEOPLE));
    });

    it('keeps everything within the thirty whole days before today', () => {
      for (let gameId = 1; gameId <= 40; gameId++) {
        const plan = planSignals(gameId, 1, PEOPLE);
        const days = [...plan.views, ...plan.likes, ...plan.comments, ...plan.plays].map(
          (signal) => signal.daysAgo,
        );

        expect(Math.min(...days, 1)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...days, 30)).toBeLessThanOrEqual(30);
      }
    });

    it('never has an author like or comment their own game', () => {
      for (let gameId = 1; gameId <= 40; gameId++) {
        const plan = planSignals(gameId, 3, PEOPLE);

        expect(plan.likes.map((like) => like.userId)).not.toContain(3);
        expect(plan.comments.map((comment) => comment.authorId)).not.toContain(3);
      }
    });

    it('makes some games rise and others fade, so trending is not popular in another order', () => {
      const lately = (gameId: number): boolean => {
        const { views } = planSignals(gameId, 1, PEOPLE);
        const seen = (from: number, to: number): number =>
          views
            .filter((day) => day.daysAgo >= from && day.daysAgo <= to)
            .reduce((sum, day) => sum + day.viewers, 0);

        return seen(1, 7) > seen(24, 30);
      };
      const rising = Array.from({ length: 40 }, (_, index) => lately(index + 1));

      expect(rising.filter(Boolean).length).toBeGreaterThan(8);
      expect(rising.filter((one) => !one).length).toBeGreaterThan(8);
    });

    it('keeps the play history inside the two weeks the friends shelf looks back on', () => {
      const days = Array.from({ length: 40 }, (_, index) => planSignals(index + 1, 1, PEOPLE))
        .flatMap((plan) => plan.plays)
        .map((play) => play.daysAgo);

      expect(days).not.toHaveLength(0);
      expect(Math.max(...days)).toBeLessThanOrEqual(13);
    });
  });

  describe('seedHubSignals', () => {
    const updatedAt = new Date('2026-11-02T08:00:00Z');
    /** The view rows the table holds, as `project:viewer:day`. */
    let views: Set<string>;

    const prisma = {
      project: { findMany: jest.fn(), update: jest.fn() },
      releaseView: { groupBy: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
      like: { upsert: jest.fn(), groupBy: jest.fn() },
      comment: { deleteMany: jest.fn(), createMany: jest.fn() },
      analyticsUserDaily: { deleteMany: jest.fn(), createMany: jest.fn() },
      hubSnapshot: { deleteMany: jest.fn() },
    };
    const seed = (): Promise<string> =>
      seedHubSignals(prisma as unknown as PrismaClient, PEOPLE, NOW);

    beforeEach(() => {
      jest.resetAllMocks();
      views = new Set(['7:seed:0:old', '7:seed:1:old', '7:seed:0:older']);
      prisma.project.findMany.mockResolvedValue([{ id: 7, userId: 2, updatedAt }]);
      prisma.releaseView.groupBy.mockImplementation(async () => {
        const perViewer = new Map<string, number>();
        for (const row of views) {
          const [projectId, , viewer] = row.split(':');
          const key = `${projectId}:${viewer}`;
          perViewer.set(key, (perViewer.get(key) ?? 0) + 1);
        }
        return [...perViewer].map(([key, count]) => ({
          projectId: Number(key.split(':')[0]),
          viewerKey: `seed:${key.split(':')[1]}`,
          _count: { _all: count },
        }));
      });
      prisma.releaseView.deleteMany.mockImplementation(async () => views.clear());
      prisma.releaseView.createMany.mockImplementation(
        async ({ data }: { data: { projectId: number; viewerKey: string; day: Date }[] }) =>
          data.forEach((row) =>
            views.add(`${row.projectId}:${row.viewerKey}:${row.day.toISOString()}`),
          ),
      );
      prisma.like.groupBy.mockResolvedValue([{ projectId: 7, _count: { _all: 4 } }]);
    });

    it('writes nothing while no game is published', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await expect(seed()).resolves.toContain('no published game yet');

      expect(prisma.releaseView.createMany).not.toHaveBeenCalled();
      expect(prisma.hubSnapshot.deleteMany).not.toHaveBeenCalled();
    });

    it('moves the counters by what it added over what an earlier run had left', async () => {
      const plan = planSignals(7, 2, PEOPLE);
      const planned = plan.views.reduce((sum, day) => sum + day.viewers, 0);
      const viewers = Math.max(...plan.views.map((day) => day.viewers));

      await seed();

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          viewCount: { increment: planned - 3 },
          uniquePlayers: { increment: viewers - 2 },
          likes: 4,
          updatedAt,
        },
      });
    });

    it('dates every view on a whole day before today', async () => {
      await seed();

      const [{ data }] = prisma.releaseView.createMany.mock.calls[0] as [{ data: { day: Date }[] }];
      expect(data).not.toHaveLength(0);
      for (const { day } of data) {
        expect(day.getTime() % DAY_MS).toBe(0);
        expect(day.getTime()).toBeLessThan(TODAY.getTime());
        expect(day.getTime()).toBeGreaterThanOrEqual(TODAY.getTime() - 30 * DAY_MS);
      }
    });

    it('replaces only the comments and the play history it wrote', async () => {
      await seed();

      expect(prisma.comment.deleteMany).toHaveBeenCalledWith({
        where: { authorId: { in: PEOPLE }, content: { in: expect.any(Array) } },
      });
      const [{ where }] = prisma.analyticsUserDaily.deleteMany.mock.calls[0] as [
        { where: { visitorId: { in: string[] } } },
      ];
      expect(where.visitorId.in).toHaveLength(PEOPLE.length);
      for (const visitorId of where.visitorId.in) {
        expect(visitorId).toMatch(/^5eedf00d-0000-4000-8000-[0-9a-f]{12}$/);
      }
    });

    it('has the hub of the day drawn again', async () => {
      await seed();

      expect(prisma.hubSnapshot.deleteMany).toHaveBeenCalledWith({ where: { day: TODAY } });
    });
  });
});
