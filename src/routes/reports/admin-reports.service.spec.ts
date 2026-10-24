import { NotFoundException } from '@nestjs/common';

import { USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { AdminReportsService } from './admin-reports.service';

describe('AdminReportsService', () => {
  const prisma = {
    report: { count: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
    project: { findMany: jest.fn() },
    $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
  };
  const user = {
    id: 9,
    username: 'kay',
    nickname: 'Kay',
    email: 'kay@example.com',
    role: USER,
    createdAt: new Date('2026-09-01'),
    deletedAt: null,
  };
  const rating = {
    id: 5,
    kind: 'RATING',
    status: 'NEW',
    createdAt: new Date('2026-10-20T10:00:00.000Z'),
    updatedAt: new Date('2026-10-20T10:00:00.000Z'),
    user,
    role: 'PLAYER',
    route: null,
    releaseId: 42,
    score: 3,
    reasons: ['BUGS'],
    liked: null,
    improve: 'Loading',
    origin: 'PROMPT',
    adminNote: null,
    appRelease: null,
    title: null,
    message: null,
    category: null,
    ratingId: null,
    projectId: null,
    context: null,
    screenshotKey: null,
    screenshotMime: null,
    screenshotBytes: null,
    followUps: [{ id: 31 }],
    source: null,
    count: 1,
    lastSeen: null,
    regressedAt: null,
    stack: null,
    occurrences: [],
  };
  let service: AdminReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.project.findMany.mockResolvedValue([
      { id: 42, name: 'cave', publishedName: 'Cave Diver' },
    ]);
    service = new AdminReportsService(
      prisma as unknown as PrismaService,
      {} as unknown as S3Service,
    );
  });

  it('filters by kind, view, role, low scores, comments and days', async () => {
    prisma.report.count.mockResolvedValue(1);
    prisma.report.findMany.mockResolvedValue([rating]);

    const list = await service.list(
      {
        kind: 'RATING',
        view: 'OPEN',
        role: 'PLAYER',
        maxScore: 4,
        withComments: true,
        from: '2026-10-01',
        to: '2026-10-20',
      },
      'created',
      { page: 1 },
    );

    expect(prisma.report.count).toHaveBeenCalledWith({
      where: {
        kind: 'RATING',
        status: { in: ['NEW', 'TRIAGED', 'IN_PROGRESS'] },
        role: 'PLAYER',
        score: { lte: 4 },
        createdAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-10-21T00:00:00.000Z'),
        },
        OR: [{ liked: { not: null } }, { improve: { not: null } }],
      },
    });
    expect(list.items[0]).toMatchObject({
      id: 5,
      score: 3,
      release: { id: 42, name: 'Cave Diver' },
      followUpIds: [31],
      account: { username: 'kay', profileUrl: 'http://localhost:3001/u/kay', deleted: false },
    });
  });

  it('lets an exact status win over the view', async () => {
    prisma.report.count.mockResolvedValue(0);
    prisma.report.findMany.mockResolvedValue([]);

    await service.list({ view: 'OPEN', status: 'RESOLVED' }, 'created', {});

    expect(prisma.report.count).toHaveBeenCalledWith({ where: { status: { in: ['RESOLVED'] } } });
  });

  it('answers 404 for an update of a report that does not exist', async () => {
    prisma.report.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.update(99, { status: 'RESOLVED' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('clears a blank note', async () => {
    prisma.report.updateMany.mockResolvedValue({ count: 1 });
    prisma.report.findUnique.mockResolvedValue(rating);

    await service.update(5, { adminNote: '   ' });

    expect(prisma.report.updateMany).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { adminNote: null },
    });
  });

  it('sums ratings up by score and by role, period by period', async () => {
    prisma.report.findMany.mockResolvedValue([
      { score: 2, role: 'PLAYER', createdAt: new Date('2026-10-01T10:00:00.000Z') },
      { score: 9, role: 'CREATOR', createdAt: new Date('2026-10-02T10:00:00.000Z') },
      { score: 10, role: 'CREATOR', createdAt: new Date('2026-10-02T11:00:00.000Z') },
    ]);

    const summary = await service.ratingSummary('2026-10-01', '2026-10-02', 'DAY');

    expect(summary).toEqual({
      count: 3,
      average: 7,
      lowShare: 0.333,
      distribution: [0, 1, 0, 0, 0, 0, 0, 0, 1, 1],
      player: { count: 1, average: 2 },
      creator: { count: 2, average: 9.5 },
      series: [
        { start: '2026-10-01', count: 1, average: 2 },
        { start: '2026-10-02', count: 2, average: 9.5 },
      ],
    });
  });

  it('reads a bug report with its context, screenshot and the rating it followed', async () => {
    prisma.report.findUnique.mockResolvedValue({
      ...rating,
      kind: 'BUG',
      score: null,
      reasons: [],
      followUps: [],
      title: 'No music',
      message: 'The song never starts.',
      category: 'SOUND',
      ratingId: 5,
      context: { viewport: '1280x720' },
      screenshotKey: 'reports/31/screenshot.webp',
      screenshotMime: 'image/webp',
      screenshotBytes: 2048,
      rating: { id: 5, score: 3, liked: null, improve: 'Loading' },
    });

    const detail = await service.detail(31);

    expect(detail).toMatchObject({
      kind: 'BUG',
      title: 'No music',
      category: 'SOUND',
      hasScreenshot: true,
      context: { viewport: '1280x720' },
      rating: { id: 5, score: 3 },
      screenshot: { mime: 'image/webp', bytes: 2048 },
    });
  });

  it('counts the reports of a kind in a status', async () => {
    prisma.report.count.mockResolvedValue(2);

    await expect(service.count('BUG', 'NEW')).resolves.toBe(2);
    expect(prisma.report.count).toHaveBeenCalledWith({ where: { kind: 'BUG', status: 'NEW' } });
  });

  it('sorts crashes by when they were last seen, or by how often', async () => {
    prisma.report.count.mockResolvedValue(0);
    prisma.report.findMany.mockResolvedValue([]);

    await service.list({ kind: 'CRASH', source: 'ENGINE' }, 'count', { page: 2, limit: 10 });

    expect(prisma.report.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kind: 'CRASH', source: 'ENGINE' },
        orderBy: [{ count: 'desc' }, { lastSeen: { sort: 'desc', nulls: 'last' } }],
        skip: 10,
        take: 10,
      }),
    );
  });

  it('reads a crash with its stack and latest occurrences', async () => {
    prisma.report.findUnique.mockResolvedValue({
      ...rating,
      kind: 'CRASH',
      user: null,
      score: null,
      reasons: [],
      followUps: [],
      rating: null,
      title: 'TypeError',
      message: 'x is undefined',
      source: 'WEB',
      count: 37,
      lastSeen: new Date('2026-10-24T09:00:00.000Z'),
      stack: 'TypeError: x\n    at update (src/app/player.ts:12:5)',
      occurrences: [
        {
          id: 900,
          createdAt: new Date('2026-10-24T09:00:00.000Z'),
          route: '/play/:id',
          appRelease: '0.1.0+8f78127',
          device: 'desktop',
          browser: 'Firefox',
          os: 'Linux',
          extra: ['not', 'an', 'object'],
        },
      ],
    });

    const detail = await service.detail(4);

    expect(detail).toMatchObject({
      kind: 'CRASH',
      account: null,
      source: 'WEB',
      count: 37,
      stack: expect.stringContaining('src/app/player.ts:12:5'),
      occurrences: [{ id: 900, route: '/play/:id', extra: null }],
    });
  });
});
