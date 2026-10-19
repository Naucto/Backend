import { withEnv } from '../../../test/env';
import { USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { AdminFeedbackService } from './admin-feedback.service';

describe('AdminFeedbackService', () => {
  const prisma = {
    $transaction: jest.fn(),
    platformRating: { count: jest.fn(), findMany: jest.fn() },
    project: { findMany: jest.fn() },
  };
  const account = {
    id: 7,
    username: 'ada',
    nickname: 'Ada',
    email: 'ada@example.com',
    role: USER,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
  const service = (): AdminFeedbackService =>
    new AdminFeedbackService(prisma as unknown as PrismaService, {} as S3Service);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));
    prisma.project.findMany.mockResolvedValue([{ id: 42, name: 'Draft', publishedName: 'Rocket' }]);
  });

  it('names the account with its profile link and email, and the game it followed', async () => {
    withEnv({ FRONTEND_URL: 'https://naucto.test/' });
    prisma.platformRating.count.mockResolvedValue(2);
    prisma.platformRating.findMany.mockResolvedValue([
      {
        id: 1,
        score: 9,
        reasons: [],
        liked: 'The palette',
        improve: null,
        context: 'PLAYER',
        source: 'PROMPT',
        appRelease: null,
        createdAt: new Date(),
        releaseId: 42,
        user: account,
        bugReports: [],
      },
      {
        id: 2,
        score: 2,
        reasons: ['BUGS'],
        liked: null,
        improve: null,
        context: 'CREATOR',
        source: 'MANUAL',
        appRelease: null,
        createdAt: new Date(),
        releaseId: null,
        user: { ...account, id: 8, username: 'deleted_8_x', deletedAt: new Date() },
        bugReports: [{ id: 3 }],
      },
    ]);

    const list = await service().ratings({ withComments: false });

    expect(list.total).toBe(2);
    expect(list.items[0]?.account).toMatchObject({
      username: 'ada',
      email: 'ada@example.com',
      profileUrl: 'https://naucto.test/u/ada',
      deleted: false,
    });
    expect(list.items[0]?.release).toEqual({ id: 42, name: 'Rocket' });
    expect(list.items[1]?.account).toMatchObject({ profileUrl: null, deleted: true });
    expect(list.items[1]?.bugReportIds).toEqual([3]);
  });

  it('filters ratings that came with a comment', async () => {
    prisma.platformRating.count.mockResolvedValue(0);
    prisma.platformRating.findMany.mockResolvedValue([]);

    await service().ratings({
      withComments: true,
      maxScore: 4,
      from: '2026-10-01',
      to: '2026-10-31',
    });

    expect(prisma.platformRating.count).toHaveBeenCalledWith({
      where: {
        score: { lte: 4 },
        createdAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-11-01T00:00:00.000Z'),
        },
        OR: [{ liked: { not: null } }, { improve: { not: null } }],
      },
    });
  });

  it('summarises a range with every period present, empty ones included', async () => {
    prisma.platformRating.findMany.mockResolvedValue([
      { score: 2, context: 'PLAYER', createdAt: new Date('2026-10-01T10:00:00.000Z') },
      { score: 8, context: 'PLAYER', createdAt: new Date('2026-10-01T11:00:00.000Z') },
      { score: 10, context: 'CREATOR', createdAt: new Date('2026-10-03T09:00:00.000Z') },
    ]);

    const summary = await service().ratingSummary({
      from: '2026-10-01',
      to: '2026-10-03',
      grain: 'DAY',
    });

    expect(summary).toMatchObject({
      count: 3,
      average: 6.67,
      lowShare: 0.333,
      player: { count: 2, average: 5 },
      creator: { count: 1, average: 10 },
    });
    expect(summary.distribution).toEqual([0, 1, 0, 0, 0, 0, 0, 1, 0, 1]);
    expect(summary.series).toEqual([
      { start: '2026-10-01', count: 2, average: 5 },
      { start: '2026-10-02', count: 0, average: null },
      { start: '2026-10-03', count: 1, average: 10 },
    ]);
  });
});
