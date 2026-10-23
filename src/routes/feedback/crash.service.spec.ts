import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { CRASH_EVENTS_KEPT, CrashInput, CrashService } from './crash.service';
import { CrashNotifier } from './crash-notifier';

describe('CrashService', () => {
  const prisma = {
    crashGroup: { upsert: jest.fn(), updateMany: jest.fn() },
    crashEvent: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const features = { features: { monetization: false, analytics: false, feedback: true } };
  const notifier = { notify: jest.fn() };
  let service: CrashService;

  const crash: CrashInput = {
    source: 'WEB',
    name: 'TypeError',
    message: 'x is undefined',
    stack: 'TypeError: x\n    at run (https://naucto.net/main-AB12CD34.js:1:2)',
    route: '/hub',
    appRelease: 'abc123',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605 Safari/605',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    features.features.feedback = true;
    prisma.crashGroup.upsert.mockResolvedValue({ id: 3, status: 'OPEN' });
    prisma.crashEvent.findMany.mockResolvedValue([]);
    prisma.crashGroup.updateMany.mockResolvedValue({ count: 1 });
    service = new CrashService(
      prisma as unknown as PrismaService,
      features as unknown as FeaturesService,
      notifier as unknown as CrashNotifier,
    );
    jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  it('records nothing while feedback is off', async () => {
    features.features.feedback = false;

    await service.record(crash);

    expect(prisma.crashGroup.upsert).not.toHaveBeenCalled();
  });

  it('counts the crash into its group and keeps the occurrence without the full user agent', async () => {
    await service.record(crash);

    expect(prisma.crashGroup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ source: 'WEB', name: 'TypeError' }),
        update: expect.objectContaining({ count: { increment: 1 } }),
      }),
    );
    expect(prisma.crashEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        groupId: 3,
        route: '/hub',
        browser: 'Safari',
        os: 'Mac OS',
        device: 'desktop',
      }),
    });
  });

  it('reopens a resolved group as a regression', async () => {
    prisma.crashGroup.upsert.mockResolvedValue({ id: 3, status: 'RESOLVED' });

    await service.record(crash);

    expect(prisma.crashGroup.updateMany).toHaveBeenCalledWith({
      where: { id: 3, status: 'RESOLVED' },
      data: { status: 'OPEN', regressedAt: expect.any(Date) },
    });
  });

  it('leaves an ignored group ignored', async () => {
    prisma.crashGroup.upsert.mockResolvedValue({ id: 3, status: 'IGNORED' });

    await service.record(crash);

    expect(prisma.crashGroup.updateMany).not.toHaveBeenCalled();
  });

  it('retries once when two first reports race to create the group', async () => {
    prisma.crashGroup.upsert
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
      )
      .mockResolvedValueOnce({ id: 3, status: 'OPEN' });

    await service.record(crash);

    expect(prisma.crashGroup.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.crashEvent.create).toHaveBeenCalled();
  });

  it('prunes the occurrences past the ones it keeps', async () => {
    prisma.crashEvent.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.record(crash);

    expect(prisma.crashEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { groupId: 3 }, skip: CRASH_EVENTS_KEPT }),
    );
    expect(prisma.crashEvent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] } } });
  });

  it.each([
    ['a first occurrence', { status: 'OPEN', count: 1 }, 'new'],
    ['a regression', { status: 'RESOLVED', count: 7 }, 'regressed'],
    ['a milestone', { status: 'OPEN', count: 100 }, 'milestone'],
  ])('announces %s', async (_, group, kind) => {
    prisma.crashGroup.upsert.mockResolvedValue({ id: 3, ...group });

    await service.record(crash);

    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind, groupId: 3, count: group.count, route: '/hub' }),
    );
  });

  it.each([
    ['an ordinary repeat', { status: 'OPEN', count: 4 }],
    ['an ignored group', { status: 'IGNORED', count: 1 }],
  ])('stays quiet on %s', async (_, group) => {
    prisma.crashGroup.upsert.mockResolvedValue({ id: 3, ...group });

    await service.record(crash);

    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('announces a regression once when two reports reopen it together', async () => {
    prisma.crashGroup.upsert.mockResolvedValue({ id: 3, status: 'RESOLVED', count: 7 });
    prisma.crashGroup.updateMany.mockResolvedValue({ count: 0 });

    await service.record(crash);

    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('never throws from recordSafely', async () => {
    prisma.crashGroup.upsert.mockRejectedValue(new Error('database down'));

    await expect(service.recordSafely(crash)).resolves.toBeUndefined();
  });
});
