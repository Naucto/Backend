import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsProjectionService } from './analytics-projection.service';

const VISITOR = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-08T12:00:00Z');
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

describe('AnalyticsProjectionService', () => {
  let tx: {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    analyticsVisitor: { findUnique: jest.Mock; update: jest.Mock };
    analyticsUserDaily: { deleteMany: jest.Mock };
    analyticsProjectionWork: { deleteMany: jest.Mock };
  };
  const prisma = {
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    analyticsProjectionWork: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  let service: AnalyticsProjectionService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ day: '2026-10-07' }]),
      analyticsVisitor: {
        findUnique: jest.fn().mockResolvedValue({ userId: 5, projectedThrough: null }),
        update: jest.fn(),
      },
      analyticsUserDaily: { deleteMany: jest.fn() },
      analyticsProjectionWork: { deleteMany: jest.fn() },
    };
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    prisma.$queryRaw.mockResolvedValue([{ day: '2026-10-07' }]);
    prisma.analyticsProjectionWork.findMany.mockResolvedValue([
      { visitorId: VISITOR, userId: 5, attempts: 0 },
    ]);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new AnalyticsProjectionService(prisma as unknown as PrismaService);
  });

  it('holds the account lock shared before reading the visitor, so it waits for an erasure', async () => {
    await service.project(VISITOR, 5);

    expect(sqlOf(tx.$executeRaw.mock.calls[0] ?? [])).toContain('pg_advisory_xact_lock_shared(');
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.analyticsVisitor.findUnique.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('replaces the rows of every final day after the watermark, moves it, and drops the work', async () => {
    tx.analyticsVisitor.findUnique.mockResolvedValue({
      userId: 5,
      projectedThrough: new Date('2026-10-03T00:00:00Z'),
    });

    await expect(service.project(VISITOR, 5)).resolves.toBe('projected');

    expect(tx.analyticsUserDaily.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 5,
        visitorId: VISITOR,
        day: { gt: new Date('2026-10-03T00:00:00Z'), lte: new Date('2026-10-07T00:00:00Z') },
      },
    });
    const insert = tx.$executeRaw.mock.calls.find((call) =>
      sqlOf(call).includes('INSERT INTO "AnalyticsUserDaily"'),
    );
    expect(insert).toEqual(expect.arrayContaining(['2026-10-03', '2026-10-07']));
    expect(tx.analyticsVisitor.update).toHaveBeenCalledWith({
      where: { id: VISITOR },
      data: { projectedThrough: new Date('2026-10-07T00:00:00Z') },
    });
    expect(tx.analyticsProjectionWork.deleteMany).toHaveBeenCalledWith({
      where: { visitorId: VISITOR },
    });
  });

  it('projects a never-projected visitor from its first activity', async () => {
    await service.project(VISITOR, 5);

    expect(tx.analyticsUserDaily.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          day: expect.objectContaining({ gt: new Date('1970-01-01T00:00:00Z') }),
        }),
      }),
    );
  });

  it('drops the work of a visitor erased or no longer linked to the account', async () => {
    tx.analyticsVisitor.findUnique.mockResolvedValue(null);

    await expect(service.project(VISITOR, 5)).resolves.toBe('dropped');

    expect(tx.analyticsUserDaily.deleteMany).not.toHaveBeenCalled();
    expect(tx.analyticsProjectionWork.deleteMany).toHaveBeenCalled();
  });

  it('keeps the work waiting, not failing, until a day is final', async () => {
    tx.$queryRaw.mockResolvedValue([{ day: null }]);

    await service.processDue(NOW);

    expect(prisma.analyticsProjectionWork.updateMany).toHaveBeenCalledWith({
      where: { visitorId: VISITOR },
      data: { nextAttemptAt: new Date(NOW.getTime() + 15 * 60_000) },
    });
  });

  it('backs off a failed projection, keeping its error, up to an hour', async () => {
    prisma.$transaction.mockRejectedValue(new Error('database is gone'));
    prisma.analyticsProjectionWork.findMany.mockResolvedValue([
      { visitorId: VISITOR, userId: 5, attempts: 2 },
      { visitorId: '22222222-2222-4222-8222-222222222222', userId: 6, attempts: 10 },
    ]);

    await service.processDue(NOW);

    expect(prisma.analyticsProjectionWork.updateMany).toHaveBeenNthCalledWith(1, {
      where: { visitorId: VISITOR },
      data: {
        attempts: 3,
        nextAttemptAt: new Date(NOW.getTime() + 4 * 60_000),
        lastError: 'Error: database is gone',
      },
    });
    expect(prisma.analyticsProjectionWork.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ nextAttemptAt: new Date(NOW.getTime() + 60 * 60_000) }),
      }),
    );
  });

  it('queues every linked visitor whose history lags behind its activity', async () => {
    prisma.$executeRaw.mockResolvedValue(3);

    await expect(service.recoveryScan(NOW)).resolves.toBe(3);

    const [scan] = prisma.$executeRaw.mock.calls;
    expect(sqlOf(scan ?? [])).toContain('INSERT INTO "AnalyticsProjectionWork"');
    expect(sqlOf(scan ?? [])).toContain('"projectedThrough" IS NULL OR');
    expect(scan).toContain('2026-10-07');
  });

  it('queues nothing before any day is final', async () => {
    prisma.$queryRaw.mockResolvedValue([{ day: null }]);

    await expect(service.recoveryScan(NOW)).resolves.toBe(0);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
