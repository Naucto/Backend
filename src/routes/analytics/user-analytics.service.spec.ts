import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsErasureService } from './analytics-erasure.service';
import { UserAnalyticsService } from './user-analytics.service';

const NOW = new Date('2026-10-08T12:00:00Z');

describe('UserAnalyticsService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    analyticsVisitor: { findMany: jest.fn() },
    analyticsUserDaily: { findFirst: jest.fn(), findMany: jest.fn() },
    analyticsSession: { findMany: jest.fn() },
    analyticsPageView: { findMany: jest.fn() },
    analyticsPlay: { findMany: jest.fn() },
    analyticsFact: { findMany: jest.fn() },
    releaseView: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
  };
  const erasure = { erase: jest.fn() };
  let service: UserAnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.analyticsVisitor.findMany.mockResolvedValue([{ id: 'v1' }]);
    prisma.project.findMany.mockResolvedValue([{ id: 7, name: 'Draft', publishedName: 'Game' }]);
    prisma.analyticsUserDaily.findFirst.mockResolvedValue(null);
    service = new UserAnalyticsService(
      prisma as unknown as PrismaService,
      erasure as unknown as AnalyticsErasureService,
    );
  });

  describe('summary', () => {
    beforeEach(() => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          { releaseId: 7, plays: 3, playtimeMs: 90_000, monthPlays: 1, monthPlaytimeMs: 30_000 },
          { releaseId: 8, plays: 1, playtimeMs: 10_000, monthPlays: null, monthPlaytimeMs: 0 },
        ])
        .mockResolvedValueOnce([{ at: new Date('2026-10-07T20:00:00Z') }]);
    });

    it('adds up lifetime and this month across games, and names the longest played', async () => {
      const summary = await service.summary(5, NOW);

      expect(summary).toMatchObject({
        tracked: true,
        linkedBrowsers: 1,
        lifetime: { plays: 4, playtimeMs: 100_000 },
        thisMonth: { plays: 1, playtimeMs: 30_000 },
        gamesPlayed: 2,
        lastActiveAt: '2026-10-07T20:00:00.000Z',
        lastActiveIsExact: true,
      });
      expect(summary.topGames[0]).toEqual({
        releaseId: 7,
        name: 'Game',
        plays: 3,
        playtimeMs: 90_000,
      });
    });

    it('reads the month from its first day, UTC', async () => {
      await service.summary(5, NOW);

      expect(prisma.$queryRaw.mock.calls[0]).toContain('2026-10-01');
    });
  });

  it('falls back to the day of the last projected activity once the raw data is gone', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ at: null }]);
    prisma.analyticsUserDaily.findFirst.mockResolvedValue({
      day: new Date('2026-03-04T00:00:00Z'),
    });
    prisma.analyticsVisitor.findMany.mockResolvedValue([]);

    const summary = await service.summary(5, NOW);

    expect(summary).toMatchObject({
      tracked: false,
      lastActiveAt: '2026-03-04T00:00:00.000Z',
      lastActiveIsExact: false,
      lifetime: { plays: 0, playtimeMs: 0 },
    });
  });

  it('exports every kind of row it holds about the account', async () => {
    prisma.analyticsVisitor.findMany.mockResolvedValue([
      { id: 'v1', firstSeenAt: NOW, lastSeenAt: NOW, linkedAt: null },
    ]);
    prisma.analyticsSession.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.analyticsPageView.findMany.mockResolvedValue([]);
    prisma.analyticsPlay.findMany.mockResolvedValue([
      {
        id: 'p1',
        sessionId: 's1',
        releaseId: 7,
        continued: false,
        startedAt: NOW,
        activeMs: 5_000n,
        endedAt: null,
      },
    ]);
    prisma.analyticsUserDaily.findMany.mockResolvedValue([
      {
        day: new Date('2026-10-01T00:00:00Z'),
        releaseId: 7,
        plays: 1,
        activeMs: 5_000n,
        activeMinutes: 2,
      },
    ]);
    prisma.analyticsFact.findMany.mockResolvedValue([]);
    prisma.releaseView.findMany.mockResolvedValue([]);

    const exported = await service.export(5, NOW);

    expect(prisma.releaseView.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { viewerKey: { in: ['u:5', 'v:v1'] } } }),
    );
    expect(exported.plays[0]?.activeMs).toBe(5_000);
    expect(exported.history[0]).toEqual({
      day: '2026-10-01',
      releaseId: 7,
      plays: 1,
      activeMs: 5_000,
      activeMinutes: 2,
    });
    // Every value can be written as JSON: no BigInt is left.
    expect(() => JSON.stringify(exported)).not.toThrow();
  });

  it('erases through the shared erase routine', async () => {
    erasure.erase.mockResolvedValue(2);

    await expect(service.erase(5)).resolves.toEqual({ erasedBrowsers: 2 });
    expect(erasure.erase).toHaveBeenCalledWith(5);
  });
});
