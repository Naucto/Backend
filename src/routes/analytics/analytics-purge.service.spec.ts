import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsPurgeService } from './analytics-purge.service';
import { VISITOR_COOKIE_MS } from './analytics-time';

const NOW = new Date('2026-10-08T02:30:00Z');
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

describe('AnalyticsPurgeService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    analyticsRollupStatus: { findUnique: jest.Mock };
    analyticsVisitor: { findMany: jest.Mock; deleteMany: jest.Mock };
    analyticsVisitorTombstone: { createMany: jest.Mock };
  };
  const prisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    analyticsVisitorTombstone: { deleteMany: jest.fn() },
    releaseView: { deleteMany: jest.fn() },
  };
  let service: AnalyticsPurgeService;
  let warn: jest.SpyInstance;

  const deletes = (): string[] =>
    tx.$executeRaw.mock.calls.map(sqlOf).filter((sql) => sql.trim().startsWith('DELETE'));

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ unprojected: 0 }]),
      analyticsRollupStatus: { findUnique: jest.fn().mockResolvedValue({ status: 'FINAL' }) },
      analyticsVisitor: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      analyticsVisitorTombstone: { createMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    prisma.$queryRaw.mockResolvedValue([]);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new AnalyticsPurgeService(prisma as unknown as PrismaService);
  });

  it('holds the purge gate exclusively before checking anything', async () => {
    await service.purgeDay('2026-06-01');

    const [gate] = tx.$executeRaw.mock.calls;
    expect(sqlOf(gate ?? [])).toContain('pg_advisory_xact_lock(');
    expect(sqlOf(gate ?? [])).not.toContain('_shared');
    expect(gate?.[1]).toBe(3);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.analyticsRollupStatus.findUnique.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps a day not final for every class, its week and its month', async () => {
    tx.analyticsRollupStatus.findUnique
      .mockResolvedValueOnce({ status: 'FINAL' })
      .mockResolvedValue(null);

    await expect(service.purgeDay('2026-06-01')).resolves.toBe('not-final');
    expect(deletes()).toEqual([]);
  });

  it('checks the week and the month holding the day', async () => {
    await service.purgeDay('2026-06-03');

    const periods = tx.analyticsRollupStatus.findUnique.mock.calls.map(
      ([args]) =>
        (
          args as {
            where: { metric_version_grain_periodStart: { grain: string; periodStart: Date } };
          }
        ).where.metric_version_grain_periodStart,
    );
    expect(periods).toContainEqual(
      expect.objectContaining({ grain: 'WEEK', periodStart: new Date('2026-06-01T00:00:00Z') }),
    );
    expect(periods).toContainEqual(
      expect.objectContaining({ grain: 'MONTH', periodStart: new Date('2026-06-01T00:00:00Z') }),
    );
  });

  it('keeps a day a linked visitor still needs for its history, an unprojected one included', async () => {
    tx.$queryRaw.mockResolvedValue([{ unprojected: 1 }]);

    await expect(service.purgeDay('2026-06-01')).resolves.toBe('not-projected');
    expect(deletes()).toEqual([]);
    const [gate] = tx.$queryRaw.mock.calls;
    expect(sqlOf(gate ?? [])).toContain('"projectedThrough" IS NULL OR');
  });

  it("deletes the day's raw activity once nothing needs it", async () => {
    await expect(service.purgeDay('2026-06-01')).resolves.toBe('purged');

    const tables = deletes().map((sql) => /DELETE FROM "(\w+)"/.exec(sql)?.[1]);
    expect(tables).toEqual(
      expect.arrayContaining([
        'AnalyticsSessionDay',
        'AnalyticsPlayDay',
        'AnalyticsPageView',
        'AnalyticsPlay',
        'AnalyticsSession',
        'AnalyticsAnonTally',
        'AnalyticsFact',
        'AnalyticsMpDay',
        'AnalyticsMpSeat',
        'AnalyticsMpSession',
        'ConcurrencySample',
        'AnalyticsIngestStat',
      ]),
    );
    expect(deletes().join('\n')).not.toContain('"AnalyticsUserDaily"');
    expect(deletes().join('\n')).not.toContain('"AnalyticsRollup"');
  });

  it('purges old days oldest first and stops at the first it must keep', async () => {
    prisma.$queryRaw.mockResolvedValue([{ day: '2026-06-01' }, { day: '2026-06-02' }]);
    tx.analyticsRollupStatus.findUnique.mockResolvedValue(null);

    await service.purge(NOW);

    expect(prisma.$queryRaw).toHaveBeenCalledWith(expect.anything(), '2026-07-10');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('2026-06-01 kept: not-final'));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('expires visitors past their cookie lifetime with nothing left, tombstoning each', async () => {
    tx.analyticsVisitor.findMany.mockResolvedValueOnce([{ id: 'v1' }, { id: 'v2' }]);
    tx.analyticsVisitor.deleteMany.mockResolvedValue({ count: 2 });

    await expect(service.expireVisitors(NOW)).resolves.toBe(2);

    expect(tx.analyticsVisitor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          firstSeenAt: { lt: new Date(NOW.getTime() - VISITOR_COOKIE_MS) },
          lastSeenAt: { lt: new Date(NOW.getTime() - 90 * 86_400_000) },
          sessions: { none: {} },
        },
      }),
    );
    expect(tx.analyticsVisitorTombstone.createMany).toHaveBeenCalledWith({
      data: [
        { id: 'v1', erasedAt: NOW },
        { id: 'v2', erasedAt: NOW },
      ],
      skipDuplicates: true,
    });
    expect(tx.analyticsVisitorTombstone.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.analyticsVisitor.deleteMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('forgets tombstones and anonymous view keys no cookie can still match', async () => {
    await service.expireKeys(NOW);

    const before = new Date(NOW.getTime() - VISITOR_COOKIE_MS);
    expect(prisma.analyticsVisitorTombstone.deleteMany).toHaveBeenCalledWith({
      where: { erasedAt: { lt: before } },
    });
    expect(prisma.releaseView.deleteMany).toHaveBeenCalledWith({
      where: { viewerKey: { startsWith: 'v:' }, createdAt: { lt: before } },
    });
  });
});
