import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import {
  CRASH_EVENTS_KEPT,
  CRASH_NEW_GROUPS_PER_HOUR,
  CrashInput,
  CrashService,
} from './crash.service';
import { CrashNotifier } from './crash-notifier';

describe('CrashService', () => {
  const prisma = {
    crashGroup: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
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

  it('keeps no email, token, query or username in what it stores', async () => {
    await service.record({
      ...crash,
      message: 'No account for ada@example.com at https://naucto.net/u/ada?token=eyJa.eyJb.sig',
      stack: 'Error\n    at load (https://naucto.net/u/ada/main.js?session=42:1:2)',
      route: '/u/ada',
    });

    const create = (
      prisma.crashGroup.upsert.mock.calls[0] as [{ create: Record<string, string> }]
    )[0].create;
    expect(create['message']).toBe('No account for <email> at https://naucto.net/u/:username');
    expect(create['lastStack']).toBe(
      'Error\n    at load (https://naucto.net/u/:username/main.js:1:2)',
    );
    expect(prisma.crashEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ route: '/u/:username' }),
    });
  });

  it('opens a limited number of new groups an hour from browsers, and still counts known ones', async () => {
    prisma.crashGroup.findUnique.mockResolvedValue(null);
    for (let i = 0; i < CRASH_NEW_GROUPS_PER_HOUR; i++) {
      await service.record({ ...crash, message: `boom ${String(i)}` });
    }
    expect(prisma.crashGroup.upsert).toHaveBeenCalledTimes(CRASH_NEW_GROUPS_PER_HOUR);

    await service.record({ ...crash, message: 'one too many' });
    expect(prisma.crashGroup.upsert).toHaveBeenCalledTimes(CRASH_NEW_GROUPS_PER_HOUR);

    prisma.crashGroup.findUnique.mockResolvedValue({ id: 3 });
    await service.record(crash);
    await service.record({ ...crash, source: 'BACKEND' });
    expect(prisma.crashGroup.upsert).toHaveBeenCalledTimes(CRASH_NEW_GROUPS_PER_HOUR + 2);
  });

  it('deletes closed groups after 90 quiet days, and lone open ones after 30', async () => {
    prisma.crashGroup.deleteMany.mockResolvedValue({ count: 2 });
    jest.spyOn(service['logger'], 'log').mockImplementation();
    const now = new Date('2026-10-23T02:45:00.000Z');

    await service.purgeStale(now);

    expect(prisma.crashGroup.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            status: { in: ['RESOLVED', 'IGNORED'] },
            lastSeen: { lt: new Date('2026-07-25T02:45:00.000Z') },
          },
          { status: 'OPEN', count: 1, lastSeen: { lt: new Date('2026-09-23T02:45:00.000Z') } },
        ],
      },
    });
  });

  it('never throws from recordSafely', async () => {
    prisma.crashGroup.upsert.mockRejectedValue(new Error('database down'));

    await expect(service.recordSafely(crash)).resolves.toBeUndefined();
  });
});
