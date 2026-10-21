import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import * as queries from './analytics-timeline.queries';
import { AnalyticsTimelineService, sourceOf } from './analytics-timeline.service';

jest.mock('./analytics-timeline.queries', () => {
  const actual = jest.requireActual<typeof queries>('./analytics-timeline.queries');
  const mockedQueries = Object.fromEntries(
    Object.keys(actual.TIMELINE_QUERIES).map((metric) => [metric, jest.fn()]),
  );
  return { ...actual, TIMELINE_QUERIES: mockedQueries };
});
const mocked = queries.TIMELINE_QUERIES as unknown as Record<string, jest.Mock>;

const NOW = new Date('2026-10-21T12:30:00Z');
const HOUR = 3_600_000;
const slot = (iso: string, bucketMs = HOUR): number => Date.parse(iso) / bucketMs;

describe('AnalyticsTimelineService', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    project: { findMany: jest.fn() },
  };
  let service: AnalyticsTimelineService;

  beforeEach(() => {
    jest.clearAllMocks();
    for (const query of Object.values(mocked)) {
      query.mockResolvedValue([]);
    }
    prisma.project.findMany.mockResolvedValue([]);
    service = new AnalyticsTimelineService(prisma as unknown as PrismaService);
  });

  describe('a timeline', () => {
    it('answers every bucket, a count without rows as 0 and the future as no value', async () => {
      mocked['plays_consented']?.mockResolvedValue([
        { slot: slot('2026-10-21T10:00:00Z'), value: 4 },
        { slot: slot('2026-10-21T12:00:00Z'), value: 1 },
      ]);

      const timeline = await service.timeline(
        {
          from: '2026-10-21T10:00:00Z',
          to: '2026-10-21T14:00:00Z',
          bucket: '1h',
          metrics: ['plays_consented'],
        },
        NOW,
      );

      expect(timeline.buckets).toEqual([
        '2026-10-21T10:00:00.000Z',
        '2026-10-21T11:00:00.000Z',
        '2026-10-21T12:00:00.000Z',
        '2026-10-21T13:00:00.000Z',
      ]);
      expect(timeline.series[0]).toMatchObject({
        metric: 'plays_consented',
        values: [4, 0, 1, null],
        total: 5,
      });
    });

    it('counts a bucket of anonymous tabs by answer without pings as 0, not as no sample', async () => {
      mocked['anon_tabs_declined']?.mockResolvedValue([
        { slot: slot('2026-10-21T10:00:00Z'), value: 3 },
      ]);

      const timeline = await service.timeline(
        {
          from: '2026-10-21T10:00:00Z',
          to: '2026-10-21T12:00:00Z',
          bucket: '1h',
          metrics: ['anon_tabs_declined'],
        },
        NOW,
      );

      expect(timeline.series[0]).toMatchObject({ values: [3, 0], total: 3 });
    });

    it('leaves a presence bucket without a sample empty and takes the highest as its total', async () => {
      mocked['anon_tabs']?.mockResolvedValue([
        { slot: slot('2026-10-21T10:00:00Z'), value: 3 },
        { slot: slot('2026-10-21T12:00:00Z'), value: 7 },
      ]);

      const timeline = await service.timeline(
        {
          from: '2026-10-21T10:00:00Z',
          to: '2026-10-21T13:00:00Z',
          bucket: '1h',
          metrics: ['anon_tabs'],
        },
        NOW,
      );

      expect(timeline.series[0]).toMatchObject({ values: [3, null, 7], total: 7 });
    });

    it('counts a distinct total over the whole window, not as the sum of its buckets', async () => {
      mocked['players']?.mockImplementation((_prisma: unknown, range: queries.TimelineRange) =>
        range.slotMs === null
          ? [{ slot: 0, value: 3 }]
          : [
              { slot: slot('2026-10-21T10:00:00Z'), value: 2 },
              { slot: slot('2026-10-21T11:00:00Z'), value: 2 },
            ],
      );

      const timeline = await service.timeline(
        {
          from: '2026-10-21T10:00:00Z',
          to: '2026-10-21T12:00:00Z',
          bucket: '1h',
          metrics: ['players'],
        },
        NOW,
      );

      expect(timeline.series[0]?.total).toBe(3);
    });

    it('gives a metric only the filters it is split by, and says which it ignored', async () => {
      const timeline = await service.timeline(
        {
          from: '2026-10-21T10:00:00Z',
          to: '2026-10-21T12:00:00Z',
          bucket: '1h',
          metrics: ['plays_anonymous', 'sessions', 'plays_consented'],
          releaseId: 9,
          source: 'referrer:youtube.com',
        },
        NOW,
      );

      expect(mocked['plays_anonymous']).toHaveBeenCalledWith(prisma, expect.anything(), {
        releaseId: 9,
      });
      expect(mocked['sessions']).toHaveBeenCalledWith(prisma, expect.anything(), {
        source: { kind: 'referrer', value: 'youtube.com' },
      });
      expect(timeline.series.map((series) => series.ignoredFilters)).toEqual([
        ['source'],
        ['release'],
        [],
      ]);
    });

    it('has no value before the raw data kept', async () => {
      const timeline = await service.timeline(
        {
          from: '2026-07-21T00:00:00Z',
          to: '2026-07-26T00:00:00Z',
          bucket: '1d',
          metrics: ['signups'],
        },
        NOW,
      );

      expect(timeline.rawFrom).toBe('2026-07-23T00:00:00.000Z');
      expect(timeline.series[0]?.values).toEqual([null, null, 0, 0, 0]);
    });

    it('refuses a window longer than the raw data kept, or one with too many buckets', async () => {
      await expect(
        service.timeline({ from: '2026-01-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }, NOW),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.timeline(
          { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z', bucket: '1m' },
          NOW,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.timeline({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }, NOW),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('the game search', () => {
    it('looks for published games by name or id, and puts the game of that id first', async () => {
      prisma.project.findMany.mockResolvedValue([
        { id: 120, name: 'Orbit 12', publishedName: null, publishedAt: new Date(0) },
        { id: 12, name: 'draft', publishedName: 'Starfall', publishedAt: new Date(0) },
      ]);

      const { releases } = await service.releases({ query: '#12', limit: 5 });

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            publishedAt: { not: null },
            OR: [
              { publishedName: { contains: '#12', mode: 'insensitive' } },
              { name: { contains: '#12', mode: 'insensitive' } },
              { id: 12 },
            ],
          },
          take: 5,
        }),
      );
      expect(releases.map((release) => release.name)).toEqual(['Starfall', 'Orbit 12']);
    });

    it('names the projects of given ids whatever their state, ignoring the query', async () => {
      prisma.project.findMany.mockResolvedValue([
        { id: 7, name: 'Fork of Orbit', publishedName: null, publishedAt: null },
      ]);

      const { releases } = await service.releases({ ids: [7], query: 'ignored' });

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [7] } } }),
      );
      expect(releases).toEqual([{ releaseId: 7, name: 'Fork of Orbit', publishedAt: null }]);
    });
  });

  describe('a journey code', () => {
    it('is the same for a browser within one backend, and never its cookie', () => {
      const visitorId = '6a1f4ad2-2a8f-4c43-9b37-3cdb1c0c9b9e';
      const code = service.journeyOf(visitorId);

      expect(code).toMatch(/^[0-9a-f]{6}$/);
      expect(service.journeyOf(visitorId)).toBe(code);
      expect(visitorId).not.toContain(code);
    });
  });

  it('names a session by its campaign first, then its utm source, then its referrer', () => {
    expect(sourceOf({ referrer: 'x.com', utmSource: 'news', utmCampaign: 'launch' })).toBe(
      'utmCampaign:launch',
    );
    expect(sourceOf({ referrer: 'x.com', utmSource: 'news', utmCampaign: null })).toBe(
      'utmSource:news',
    );
    expect(sourceOf({ referrer: null, utmSource: null, utmCampaign: null })).toBe(
      'referrer:(none)',
    );
  });

  describe('arrivals', () => {
    it('tells new accounts from existing ones and adds anonymous plays to the games', async () => {
      const firstSeenAt = new Date('2026-10-21T10:00:00Z');
      const visitor = {
        firstSeenAt,
        lastSeenAt: firstSeenAt,
        referrer: 'youtube.com',
        utmSource: null,
        utmCampaign: null,
        country: 'FR',
        device: 'desktop',
        sessions: 1,
        projectCreatedAt: null,
        publishedAt: null,
      };
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            ...visitor,
            visitorId: '6a1f4ad2-2a8f-4c43-9b37-3cdb1c0c9b9e',
            plays: 2,
            firstPlayAt: new Date('2026-10-21T10:05:00Z'),
            releases: [9, 9],
            linked: true,
            signedUpAt: new Date('2026-10-21T10:20:00Z'),
          },
          {
            ...visitor,
            visitorId: '7b2f4ad2-2a8f-4c43-9b37-3cdb1c0c9b9e',
            plays: 0,
            firstPlayAt: null,
            releases: null,
            linked: true,
            signedUpAt: new Date('2025-01-01T00:00:00Z'),
          },
        ])
        .mockResolvedValueOnce([
          { all: 6, declined: 4, unanswered: 2, signedIn: 1, unlinkedSignups: 2 },
        ])
        .mockResolvedValueOnce([{ releaseId: 9, plays: 5 }]);
      prisma.project.findMany.mockResolvedValue([{ id: 9, name: 'draft', publishedName: 'Orbs' }]);

      const arrivals = await service.arrivals({
        from: '2026-10-21T09:00:00Z',
        to: '2026-10-21T12:00:00Z',
      });

      expect(arrivals.summary).toMatchObject({
        arrived: 2,
        played: 1,
        signedUp: 1,
        existingAccounts: 1,
        anonymousPlays: 6,
        declinedPlays: 4,
        unansweredPlays: 2,
        anonymousSignedInPlays: 1,
        unlinkedSignups: 2,
      });
      expect(arrivals.games).toEqual([
        { releaseId: 9, name: 'Orbs', players: 1, plays: 2, anonymousPlays: 5 },
      ]);
      expect(arrivals.visitors.map((row) => row.account)).toEqual(['NEW', 'EXISTING']);
      expect(arrivals.visitors[1]?.signedUpAt).toBeNull();
    });
  });
});
