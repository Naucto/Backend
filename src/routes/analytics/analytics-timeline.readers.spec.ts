import { PrismaService } from '../../prisma/prisma.service';
import { cameFrom, sessionsFrom, TIMELINE_READERS } from './analytics-timeline.readers';

const RANGE = { from: new Date('2026-10-21T00:00:00Z'), to: new Date('2026-10-22T00:00:00Z') };

describe('timeline readers', () => {
  const prisma = {
    analyticsPlay: { findMany: jest.fn() },
    analyticsSession: { findMany: jest.fn() },
    analyticsVisitor: { findMany: jest.fn() },
    analyticsFact: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
    analyticsAnonTally: { groupBy: jest.fn() },
  };
  const client = prisma as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('a source', () => {
    it('filters sessions on its column, ignoring case, and direct visits on none', () => {
      expect(sessionsFrom({ kind: 'referrer', value: 'YouTube.com' })).toEqual({
        referrerDomain: { equals: 'YouTube.com', mode: 'insensitive' },
      });
      expect(sessionsFrom({ kind: 'referrer', value: null })).toEqual({ referrerDomain: null });
      expect(sessionsFrom(undefined)).toEqual({});
    });

    it('is recognised on a session the same way', () => {
      const session = { referrerDomain: 'youtube.com', utmSource: null, utmCampaign: 'Launch' };

      expect(cameFrom(session, { kind: 'referrer', value: 'YOUTUBE.com' })).toBe(true);
      expect(cameFrom(session, { kind: 'utmCampaign', value: 'launch' })).toBe(true);
      expect(cameFrom(session, { kind: 'utmSource', value: null })).toBe(true);
      expect(cameFrom(session, { kind: 'utmSource', value: 'news' })).toBe(false);
    });
  });

  it('counts a first play only when the browser had played nothing before it', async () => {
    prisma.analyticsPlay.findMany
      .mockResolvedValueOnce([
        { startedAt: new Date('2026-10-21T10:00:00Z'), session: { visitorId: 'new' } },
        { startedAt: new Date('2026-10-21T11:00:00Z'), session: { visitorId: 'old' } },
      ])
      .mockResolvedValueOnce([
        { startedAt: new Date('2026-10-01T09:00:00Z'), session: { visitorId: 'old' } },
        { startedAt: new Date('2026-10-21T10:00:00Z'), session: { visitorId: 'new' } },
        { startedAt: new Date('2026-10-21T11:00:00Z'), session: { visitorId: 'old' } },
      ]);

    const samples = await TIMELINE_READERS.players_new(client, RANGE, { releaseId: 9 });

    expect(samples).toEqual([{ at: new Date('2026-10-21T10:00:00Z'), value: 1 }]);
    expect(prisma.analyticsPlay.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          startedAt: { lt: RANGE.to },
          session: { visitorId: { in: ['new', 'old'] } },
          releaseId: 9,
        },
      }),
    );
  });

  it('counts a sign-up as unlinked when no consenting browser is linked to its account', async () => {
    prisma.analyticsFact.findMany.mockResolvedValue([
      { at: new Date('2026-10-21T10:00:00Z'), actorUserId: 1 },
      { at: new Date('2026-10-21T11:00:00Z'), actorUserId: 2 },
      { at: new Date('2026-10-21T12:00:00Z'), actorUserId: null },
    ]);
    prisma.analyticsVisitor.findMany.mockResolvedValue([{ id: 'v', userId: 1 }]);

    const samples = await TIMELINE_READERS.signups_unlinked(client, RANGE, {});

    expect(samples.map((one) => one.at.toISOString())).toEqual([
      '2026-10-21T11:00:00.000Z',
      '2026-10-21T12:00:00.000Z',
    ]);
  });

  it('counts the projects forked from the chosen game', async () => {
    prisma.analyticsFact.findMany.mockResolvedValue([
      { at: new Date('2026-10-21T10:00:00Z'), actorUserId: 1, projectId: 30 },
      { at: new Date('2026-10-21T11:00:00Z'), actorUserId: 2, projectId: 31 },
    ]);
    prisma.project.findMany.mockResolvedValue([{ id: 31 }]);

    const samples = await TIMELINE_READERS.projects_forked(client, RANGE, { releaseId: 9 });

    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { id: { in: [30, 31] }, forkedFromId: 9 },
      select: { id: true },
    });
    expect(samples).toEqual([{ at: new Date('2026-10-21T11:00:00Z'), value: 1 }]);
  });

  it('adds up anonymous plays per minute, on games only unless one is chosen', async () => {
    prisma.analyticsAnonTally.groupBy.mockResolvedValue([
      { minute: new Date('2026-10-21T10:00:00Z'), _sum: { playsStarted: 3 } },
    ]);

    const samples = await TIMELINE_READERS.plays_declined(client, RANGE, {});

    expect(prisma.analyticsAnonTally.groupBy).toHaveBeenCalledWith({
      by: ['minute'],
      where: {
        consent: 'DECLINED',
        minute: { gte: RANGE.from, lt: RANGE.to },
        playsStarted: { gt: 0 },
        releaseId: { not: 0 },
      },
      _sum: { playsStarted: true },
    });
    expect(samples).toEqual([{ at: new Date('2026-10-21T10:00:00Z'), value: 3 }]);
  });
});
