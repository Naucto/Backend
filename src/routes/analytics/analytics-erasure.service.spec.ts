import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsErasureService } from './analytics-erasure.service';

describe('AnalyticsErasureService', () => {
  const tx = {
    $executeRaw: jest.fn(),
    analyticsVisitor: { findMany: jest.fn(), deleteMany: jest.fn() },
    analyticsVisitorTombstone: { createMany: jest.fn() },
    releaseView: { deleteMany: jest.fn() },
    analyticsLiveMinute: { deleteMany: jest.fn() },
    analyticsProjectionWork: { deleteMany: jest.fn() },
    analyticsUserDaily: { deleteMany: jest.fn() },
    analyticsFact: { updateMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((run: (client: typeof tx) => Promise<number>) => run(tx)),
  };
  let service: AnalyticsErasureService;

  const visitorA = '11111111-1111-4111-8111-111111111111';
  const visitorB = '22222222-2222-4222-8222-222222222222';

  /** The SQL text of a raw call, its tagged-template strings joined. */
  const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

  beforeEach(() => {
    jest.clearAllMocks();
    tx.analyticsVisitor.findMany.mockResolvedValue([{ id: visitorA }, { id: visitorB }]);
    service = new AnalyticsErasureService(prisma as unknown as PrismaService);
  });

  it('locks the account exclusively, then its visitors, before reading or writing anything else', async () => {
    await service.erase(7);

    const [accountLock, visitorLock] = tx.$executeRaw.mock.calls;
    expect(sqlOf(accountLock ?? [])).toContain('pg_advisory_xact_lock(');
    expect(accountLock).toContain(7);
    expect(sqlOf(visitorLock ?? [])).toContain('pg_advisory_xact_lock(');
    expect(visitorLock).toContainEqual([visitorA, visitorB]);
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.analyticsVisitor.findMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('tombstones the visitors before deleting them, so nothing queued recreates them', async () => {
    await service.erase(7);

    expect(tx.analyticsVisitorTombstone.createMany).toHaveBeenCalledWith({
      data: [{ id: visitorA }, { id: visitorB }],
      skipDuplicates: true,
    });
    expect(tx.analyticsVisitor.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [visitorA, visitorB] } },
    });
    expect(tx.analyticsVisitorTombstone.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.analyticsVisitor.deleteMany.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('removes the release-view keys of the account and of each visitor', async () => {
    await service.erase(7);

    expect(tx.releaseView.deleteMany).toHaveBeenCalledWith({
      where: { viewerKey: { in: ['u:7', `v:${visitorA}`, `v:${visitorB}`] } },
    });
  });

  it('removes live minutes, pending projection work and the lifetime history', async () => {
    await service.erase(7);

    expect(tx.analyticsLiveMinute.deleteMany).toHaveBeenCalledWith({
      where: { visitorId: { in: [visitorA, visitorB] } },
    });
    expect(tx.analyticsProjectionWork.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(tx.analyticsUserDaily.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
  });

  it('keeps business facts but unlinks the account from them', async () => {
    await service.erase(7);

    expect(tx.analyticsFact.updateMany).toHaveBeenCalledWith({
      where: { actorUserId: 7 },
      data: { actorUserId: null },
    });
  });

  it('still clears account-keyed rows when the account has no visitor', async () => {
    tx.analyticsVisitor.findMany.mockResolvedValue([]);

    await expect(service.erase(7)).resolves.toBe(0);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.releaseView.deleteMany).toHaveBeenCalledWith({
      where: { viewerKey: { in: ['u:7'] } },
    });
    expect(tx.analyticsFact.updateMany).toHaveBeenCalled();
  });

  it('runs inside a transaction the caller already holds', async () => {
    await service.eraseWithin(tx as unknown as Prisma.TransactionClient, 7);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.analyticsVisitor.deleteMany).toHaveBeenCalled();
  });
});
