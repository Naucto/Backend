import { BadRequestException } from '@nestjs/common';

import { PresenceService } from '../../presence/presence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { periodOf } from './analytics-periods';
import { AnalyticsQueryService, emptyValueOf } from './analytics-query.service';
import * as queries from './analytics-rollup.queries';

jest.mock('./analytics-rollup.queries');
const mocked = jest.mocked(queries);

const NOW = new Date('2026-10-08T12:00:00Z');
const DAY = periodOf('DAY', '2026-10-02');

describe('AnalyticsQueryService', () => {
  const prisma = {
    analyticsRollupStatus: { findUnique: jest.fn() },
    analyticsRollup: { findUnique: jest.fn(), findMany: jest.fn() },
    analyticsCohort: { findMany: jest.fn() },
    project: { findMany: jest.fn() },
  };
  let service: AnalyticsQueryService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.analyticsRollupStatus.findUnique.mockResolvedValue(null);
    prisma.analyticsRollup.findUnique.mockResolvedValue(null);
    prisma.analyticsRollup.findMany.mockResolvedValue([]);
    prisma.project.findMany.mockResolvedValue([]);
    mocked.activityMetrics.mockResolvedValue([{ metric: 'visitors', dimension: '', value: 7 }]);
    mocked.samplerCoverage.mockResolvedValue(0.9);
    mocked.ingestErrorRate.mockResolvedValue(0);
    service = new AnalyticsQueryService(prisma as unknown as PrismaService, {} as PresenceService);
  });

  describe('a point', () => {
    it('reads a final period from its frozen value, with its coverage', async () => {
      prisma.analyticsRollupStatus.findUnique.mockResolvedValue({
        status: 'FINAL',
        samplerCoverage: 1,
        ingestErrorRate: 0.02,
      });
      prisma.analyticsRollup.findUnique.mockResolvedValue({ value: 42 });

      await expect(service.pointOf('visitors', '', DAY, NOW)).resolves.toEqual({
        periodStart: '2026-10-02',
        value: 42,
        status: 'final',
        samplerCoverage: 1,
        ingestErrorRate: 0.02,
      });
      expect(mocked.activityMetrics).not.toHaveBeenCalled();
    });

    it('reads a count missing from a final period as zero, a peak or a median as no value', async () => {
      prisma.analyticsRollupStatus.findUnique.mockResolvedValue({
        status: 'FINAL',
        samplerCoverage: 0,
        ingestErrorRate: 0,
      });

      expect((await service.pointOf('plays', 'release:9', DAY, NOW)).value).toBe(0);
      expect((await service.pointOf('active_browsers_peak', '', DAY, NOW)).value).toBeNull();
      expect((await service.pointOf('session_seconds_median', '', DAY, NOW)).value).toBeNull();
    });

    it('computes a period not final yet from raw data, as provisional', async () => {
      const point = await service.pointOf('visitors', '', DAY, NOW);

      expect(point).toEqual({
        periodStart: '2026-10-02',
        value: 7,
        status: 'provisional',
        samplerCoverage: 0.9,
        ingestErrorRate: 0,
      });
      expect(mocked.activityMetrics).toHaveBeenCalledWith(prisma, {
        start: '2026-10-02',
        end: '2026-10-03',
      });
    });

    it('computes a provisional period once a minute, however often it is read', async () => {
      await service.pointOf('visitors', '', DAY, NOW);
      await service.pointOf('players', '', DAY, new Date(NOW.getTime() + 30_000));
      await service.pointOf('visitors', '', DAY, new Date(NOW.getTime() + 61_000));

      expect(mocked.activityMetrics).toHaveBeenCalledTimes(2);
    });

    it('never makes up a value for a period whose raw data is gone', async () => {
      const old = periodOf('DAY', '2026-05-01');

      await expect(service.pointOf('visitors', '', old, NOW)).resolves.toMatchObject({
        value: null,
        status: 'unavailable',
      });
      expect(mocked.activityMetrics).not.toHaveBeenCalled();
    });

    it('reports a period finalized without its raw data as unavailable', async () => {
      prisma.analyticsRollupStatus.findUnique.mockResolvedValue({
        status: 'UNAVAILABLE',
        samplerCoverage: 0,
        ingestErrorRate: 0,
      });

      expect((await service.pointOf('visitors', '', DAY, NOW)).status).toBe('unavailable');
    });
  });

  describe('input', () => {
    it('refuses a range that ends before it starts', async () => {
      await expect(
        service.series(
          { metric: 'visitors', grain: 'DAY', from: '2026-10-05', to: '2026-10-01' },
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses more periods than one series holds', async () => {
      await expect(
        service.series(
          { metric: 'visitors', grain: 'DAY', from: '2024-01-01', to: '2026-01-01' },
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a breakdown by a dimension the metric is not split by', async () => {
      await expect(
        service.breakdown(
          { metric: 'visitors', dimension: 'country', grain: 'DAY', day: '2026-10-02' },
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a funnel longer than 90 days or outside the raw window', async () => {
      await expect(
        service.funnel({ from: '2026-06-01', to: '2026-10-01' }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.funnel({ from: '2026-05-01', to: '2026-05-10' }, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('flags a breakdown whose rarest values were folded', async () => {
    mocked.sessionMetrics.mockResolvedValue([
      { metric: 'sessions', dimension: '', value: 3 },
      ...Array.from({ length: 101 }, (_, i) => ({
        metric: 'sessions' as const,
        dimension: `referrer:site-${String(i)}`,
        value: 1,
      })),
    ]);

    const breakdown = await service.breakdown(
      { metric: 'sessions', dimension: 'referrer', grain: 'DAY', day: '2026-10-07' },
      NOW,
    );

    expect(breakdown.status).toBe('provisional');
    expect(breakdown.truncated).toBe(true);
    expect(breakdown.values).toHaveLength(101);
  });

  it('marks a cohort not mature yet with no retention, never zero', async () => {
    prisma.analyticsCohort.findMany.mockResolvedValue([
      {
        cohortDay: new Date('2026-10-01T00:00:00Z'),
        offsetDays: 1,
        size: 4,
        retained: 2,
        mature: true,
      },
      {
        cohortDay: new Date('2026-10-01T00:00:00Z'),
        offsetDays: 7,
        size: 4,
        retained: null,
        mature: false,
      },
    ]);

    const retention = await service.retention({
      kind: 'VISITOR',
      from: '2026-10-01',
      to: '2026-10-01',
    });

    expect(retention.cohorts[0]?.offsets).toEqual([
      { offsetDays: 1, retained: 2, rate: 0.5, mature: true },
      { offsetDays: 7, retained: null, rate: null, mature: false },
      { offsetDays: 30, retained: null, rate: null, mature: false },
    ]);
  });

  it('has no value for a peak or a median of nothing, and zero for any count', () => {
    expect(emptyValueOf('anon_tabs_peak')).toBeNull();
    expect(emptyValueOf('session_seconds_median')).toBeNull();
    expect(emptyValueOf('visitors')).toBe(0);
    expect(emptyValueOf('playtime_ms')).toBe(0);
  });
});
