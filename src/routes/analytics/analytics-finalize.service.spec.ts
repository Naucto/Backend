import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  AnalyticsFinalizeService,
  metricsOf,
  truncateDimensions,
} from './analytics-finalize.service';
import { METRICS, RETENTION_OFFSETS } from './analytics-metrics';
import * as queries from './analytics-rollup.queries';

jest.mock('./analytics-rollup.queries');
const mocked = jest.mocked(queries);

const NOW = new Date('2026-10-04T02:00:00Z');

describe('AnalyticsFinalizeService', () => {
  let tx: {
    $queryRaw: jest.Mock;
    analyticsRollup: { deleteMany: jest.Mock; createMany: jest.Mock };
    analyticsRollupStatus: { createMany: jest.Mock };
  };
  const prisma = {
    $transaction: jest.fn(),
    analyticsRollupStatus: { findMany: jest.fn() },
  };
  let service: AnalyticsFinalizeService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
      analyticsRollup: { deleteMany: jest.fn(), createMany: jest.fn() },
      analyticsRollupStatus: { createMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    prisma.analyticsRollupStatus.findMany.mockResolvedValue([]);
    mocked.earliestRawDay.mockResolvedValue({
      ACTIVITY: '2026-10-02',
      SESSION: null,
      FACT: null,
      MULTIPLAYER: null,
      PRESENCE: null,
    });
    mocked.activityMetrics.mockResolvedValue([{ metric: 'visitors', dimension: '', value: 2 }]);
    mocked.samplerCoverage.mockResolvedValue(0.5);
    mocked.ingestErrorRate.mockResolvedValue(0.01);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new AnalyticsFinalizeService(prisma as unknown as PrismaService);
  });

  it('finalizes every due period of a class that has data, oldest first', async () => {
    await expect(service.finalizeDue(NOW)).resolves.toBe(2);

    const ranges = mocked.activityMetrics.mock.calls.map(([, range]) => range);
    expect(ranges).toEqual([
      { start: '2026-10-02', end: '2026-10-03' },
      { start: '2026-10-03', end: '2026-10-04' },
    ]);
    expect(mocked.sessionMetrics).not.toHaveBeenCalled();
  });

  it('writes the values and a FINAL status for every metric of the class, with its coverage', async () => {
    await service.finalizeDue(NOW);

    expect(tx.analyticsRollup.createMany).toHaveBeenCalledWith({
      data: [
        {
          metric: 'visitors',
          version: METRICS.visitors.version,
          grain: 'DAY',
          periodStart: new Date('2026-10-02T00:00:00Z'),
          dimension: '',
          value: 2,
        },
      ],
    });
    const [[{ data: statuses }]] = tx.analyticsRollupStatus.createMany.mock.calls as [
      [{ data: Array<{ metric: string; status: string; samplerCoverage: number }> }],
    ];
    expect(statuses.map((status) => status.metric).sort()).toEqual(metricsOf('ACTIVITY').sort());
    expect(statuses.every((status) => status.status === 'FINAL')).toBe(true);
    expect(statuses[0]?.samplerCoverage).toBe(0.5);
  });

  it('never computes again a period already final at the current versions', async () => {
    prisma.analyticsRollupStatus.findMany.mockResolvedValue(
      metricsOf('ACTIVITY').map((metric) => ({
        metric,
        version: METRICS[metric].version,
        periodStart: new Date('2026-10-02T00:00:00Z'),
      })),
    );

    await service.finalizeDue(NOW);

    expect(mocked.activityMetrics).toHaveBeenCalledTimes(1);
    expect(mocked.activityMetrics.mock.calls[0]?.[1]).toEqual({
      start: '2026-10-03',
      end: '2026-10-04',
    });
  });

  it('computes a period again for a metric whose version moved on', async () => {
    prisma.analyticsRollupStatus.findMany.mockResolvedValue(
      metricsOf('ACTIVITY').map((metric) => ({
        metric,
        version: metric === 'visitors' ? METRICS.visitors.version - 1 : METRICS[metric].version,
        periodStart: new Date('2026-10-02T00:00:00Z'),
      })),
    );

    await service.finalizeDue(NOW);

    expect(mocked.activityMetrics.mock.calls.map(([, range]) => range.start)).toContain(
      '2026-10-02',
    );
  });

  it('builds and matures cohorts with each finalized activity day', async () => {
    await service.finalizeDue(NOW);

    expect(mocked.rollupCohorts).toHaveBeenCalledWith(
      tx,
      '2026-10-02',
      RETENTION_OFFSETS,
      expect.any(Number),
    );
    expect(mocked.rollupCohorts).toHaveBeenCalledWith(
      tx,
      '2026-10-03',
      RETENTION_OFFSETS,
      expect.any(Number),
    );
  });

  it('leaves a period to the runner holding the finalization lock', async () => {
    tx.$queryRaw.mockResolvedValue([{ locked: false }]);

    await expect(service.finalizeDue(NOW)).resolves.toBe(0);

    expect(tx.analyticsRollup.createMany).not.toHaveBeenCalled();
  });

  it('runs one finalization at a time in this process', async () => {
    let release: () => void = () => undefined;
    mocked.earliestRawDay.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = (): void =>
            resolve({
              ACTIVITY: null,
              SESSION: null,
              FACT: null,
              MULTIPLAYER: null,
              PRESENCE: null,
            });
        }),
    );

    const first = service.finalizeDue(NOW);
    await expect(service.finalizeDue(NOW)).resolves.toBe(0);
    release();
    await first;

    expect(mocked.earliestRawDay).toHaveBeenCalledTimes(1);
  });

  it('runs in a repeatable-read transaction with room for heavy periods', async () => {
    await service.finalizeDue(NOW);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
      timeout: 60_000,
      maxWait: 10_000,
    });
  });
});

describe('truncateDimensions', () => {
  it('keeps the top values of an unbounded dimension and folds the rest into (other)', () => {
    const referrers = Array.from({ length: 102 }, (_, i) => ({
      metric: 'sessions' as const,
      dimension: `referrer:site-${String(i)}.example`,
      value: 200 - i,
    }));

    const kept = truncateDimensions([
      { metric: 'sessions', dimension: '', value: 5 },
      ...referrers,
    ]);

    expect(kept.filter((value) => value.dimension.startsWith('referrer:'))).toHaveLength(101);
    expect(kept).toContainEqual({
      metric: 'sessions',
      dimension: 'referrer:(other)',
      value: 100 + 99,
    });
    expect(kept).toContainEqual({ metric: 'sessions', dimension: '', value: 5 });
  });

  it('keeps every value of a bounded dimension', () => {
    const countries = Array.from({ length: 150 }, (_, i) => ({
      metric: 'sessions' as const,
      dimension: `country:C${String(i)}`,
      value: 1,
    }));

    expect(truncateDimensions(countries)).toHaveLength(150);
  });
});
