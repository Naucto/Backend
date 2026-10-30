import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  CRASH_NEW_PER_HOUR,
  CRASH_OCCURRENCES_KEPT,
  CrashInput,
  CrashService,
} from './crash.service';
import { CrashNotifier } from './crash-notifier';
import { StackResolver } from './stack-resolver';

describe('CrashService', () => {
  const prisma = {
    report: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    reportOccurrence: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
  };
  const notifier = { notify: jest.fn() };
  const stacks = { resolve: jest.fn() };
  let service: CrashService;

  const crash: CrashInput = {
    source: 'WEB',
    name: 'TypeError',
    message: 'x is undefined',
    stack: 'TypeError: x\n    at run (https://naucto.net/main-AB12CD34.js:1:2)',
    route: '/hub',
    appRelease: '0.1.0+8f78127',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605 Safari/605',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.report.upsert.mockResolvedValue({ id: 3, status: 'NEW', count: 4 });
    prisma.report.updateMany.mockResolvedValue({ count: 1 });
    prisma.reportOccurrence.findMany.mockResolvedValue([]);
    stacks.resolve.mockImplementation((stack: string) =>
      Promise.resolve(stack.replace('https://naucto.net/main-AB12CD34.js:1:2', 'src/main.ts:4:1')),
    );
    service = new CrashService(
      prisma as unknown as PrismaService,
      notifier as unknown as CrashNotifier,
      stacks as unknown as StackResolver,
    );
    jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  const created = (): Record<string, unknown> =>
    (prisma.report.upsert.mock.calls[0] as [{ create: Record<string, unknown> }])[0].create;

  it('keys a crash on its name and normalised message, and stores its resolved stack', async () => {
    await service.record({ ...crash, message: 'x is undefined at 42' });

    expect(prisma.report.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind_groupKey: { kind: 'CRASH', groupKey: 'WEB:TypeError: x is undefined at <n>' },
        },
        update: expect.objectContaining({ count: { increment: 1 } }),
      }),
    );
    expect(created()).toMatchObject({
      kind: 'CRASH',
      source: 'WEB',
      title: 'TypeError',
      stack: 'TypeError: x\n    at run (src/main.ts:4:1)',
    });
    expect(prisma.reportOccurrence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reportId: 3,
        route: '/hub',
        browser: 'Safari',
        os: 'Mac OS',
        device: 'desktop',
      }),
    });
  });

  it('leaves the stack of a backend crash to Node, which has no source map to read', async () => {
    await service.record({ ...crash, source: 'BACKEND' });

    expect(stacks.resolve).not.toHaveBeenCalled();
  });

  it('keeps no email, token, query or username in what it stores', async () => {
    await service.record({
      ...crash,
      message: 'No account for ada@example.com at https://naucto.net/u/ada?token=eyJa.eyJb.sig',
      route: '/u/ada',
    });

    expect(created()['message']).toBe('No account for <email> at https://naucto.net/u/:username');
    expect(prisma.reportOccurrence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ route: '/u/:username' }),
    });
  });

  it('reopens a resolved crash as a regression and announces it', async () => {
    prisma.report.upsert.mockResolvedValue({ id: 3, status: 'RESOLVED', count: 7 });

    await service.record(crash);

    expect(prisma.report.updateMany).toHaveBeenCalledWith({
      where: { id: 3, status: 'RESOLVED' },
      data: { status: 'NEW', regressedAt: expect.any(Date) },
    });
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'regressed', reportId: 3, count: 7 }),
    );
  });

  it.each([
    ['a first occurrence', { status: 'NEW', count: 1 }, 'new'],
    ['a milestone', { status: 'TRIAGED', count: 100 }, 'milestone'],
  ])('announces %s', async (_, row, kind) => {
    prisma.report.upsert.mockResolvedValue({ id: 3, ...row });

    await service.record(crash);

    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({ kind }));
  });

  it.each([
    ['an ordinary repeat', { status: 'NEW', count: 4 }],
    ['an ignored crash', { status: 'IGNORED', count: 1 }],
  ])('stays quiet on %s', async (_, row) => {
    prisma.report.upsert.mockResolvedValue({ id: 3, ...row });

    await service.record(crash);

    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('announces a regression once when two reports reopen it together', async () => {
    prisma.report.upsert.mockResolvedValue({ id: 3, status: 'RESOLVED', count: 7 });
    prisma.report.updateMany.mockResolvedValue({ count: 0 });

    await service.record(crash);

    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('retries once when two first reports race to create the crash', async () => {
    prisma.report.upsert
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
      )
      .mockResolvedValueOnce({ id: 3, status: 'NEW', count: 2 });

    await service.record(crash);

    expect(prisma.report.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.reportOccurrence.create).toHaveBeenCalled();
  });

  it('prunes the occurrences past the ones it keeps', async () => {
    prisma.reportOccurrence.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.record(crash);

    expect(prisma.reportOccurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { reportId: 3 }, skip: CRASH_OCCURRENCES_KEPT }),
    );
    expect(prisma.reportOccurrence.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [1, 2] } },
    });
  });

  it('opens a limited number of new crashes an hour from browsers, and still counts known ones', async () => {
    prisma.report.findUnique.mockResolvedValue(null);
    for (let i = 0; i < CRASH_NEW_PER_HOUR; i++) {
      await service.record({ ...crash, message: `boom ${'x'.repeat(i)}` });
    }
    expect(prisma.report.upsert).toHaveBeenCalledTimes(CRASH_NEW_PER_HOUR);

    await service.record({ ...crash, message: 'one too many' });
    expect(prisma.report.upsert).toHaveBeenCalledTimes(CRASH_NEW_PER_HOUR);

    prisma.report.findUnique.mockResolvedValue({ id: 3 });
    await service.record(crash);
    await service.record({ ...crash, source: 'BACKEND' });
    expect(prisma.report.upsert).toHaveBeenCalledTimes(CRASH_NEW_PER_HOUR + 2);
  });

  it('deletes closed crashes after 90 quiet days, and lone new ones after 30', async () => {
    prisma.report.deleteMany.mockResolvedValue({ count: 2 });
    jest.spyOn(service['logger'], 'log').mockImplementation();

    await service.purgeStale(new Date('2026-10-23T02:45:00.000Z'));

    expect(prisma.report.deleteMany).toHaveBeenCalledWith({
      where: {
        kind: 'CRASH',
        OR: [
          {
            status: { in: ['RESOLVED', 'IGNORED'] },
            lastSeen: { lt: new Date('2026-07-25T02:45:00.000Z') },
          },
          { status: 'NEW', count: 1, lastSeen: { lt: new Date('2026-09-23T02:45:00.000Z') } },
        ],
      },
    });
  });

  it('never throws from recordSafely', async () => {
    prisma.report.upsert.mockRejectedValue(new Error('database down'));

    await expect(service.recordSafely(crash)).resolves.toBeUndefined();
  });
});
