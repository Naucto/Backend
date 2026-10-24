import { PrismaService } from '../../prisma/prisma.service';
import { PROMPT_SNOOZE_MS, ReportsService } from './reports.service';

describe('ReportsService', () => {
  const tx = {
    report: { create: jest.fn() },
    feedbackPrompt: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    ...tx,
    feedbackPrompt: { ...tx.feedbackPrompt, deleteMany: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const now = new Date('2026-10-24T12:00:00.000Z');
  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.feedbackPrompt.findUnique.mockResolvedValue(null);
    tx.feedbackPrompt.findUnique.mockResolvedValue(null);
    service = new ReportsService(prisma as unknown as PrismaService);
  });

  describe('promptState', () => {
    it('may ask an account it never asked', async () => {
      await expect(service.promptState(7, now)).resolves.toEqual({
        eligible: true,
        declined: false,
      });
    });

    it.each([
      ['answered', { status: 'ANSWERED', snoozedUntil: null }, false, false],
      ['declined', { status: 'DECLINED', snoozedUntil: null }, false, true],
      [
        'snoozed until later',
        { status: 'SNOOZED', snoozedUntil: new Date('2026-10-30') },
        false,
        false,
      ],
      [
        'snoozed until before',
        { status: 'SNOOZED', snoozedUntil: new Date('2026-10-01') },
        true,
        false,
      ],
    ])('reads an account that %s', async (_, row, eligible, declined) => {
      prisma.feedbackPrompt.findUnique.mockResolvedValue(row);

      await expect(service.promptState(7, now)).resolves.toEqual({ eligible, declined });
    });
  });

  describe('updatePrompt', () => {
    it('snoozes for 14 days', async () => {
      await service.updatePrompt(7, 'snooze', now);

      expect(tx.feedbackPrompt.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: {
            userId: 7,
            status: 'SNOOZED',
            snoozedUntil: new Date(now.getTime() + PROMPT_SNOOZE_MS),
          },
        }),
      );
    });

    it('never snoozes an answer or a refusal given before', async () => {
      tx.feedbackPrompt.findUnique.mockResolvedValue({ status: 'DECLINED' });

      await service.updatePrompt(7, 'snooze', now);

      expect(tx.feedbackPrompt.upsert).not.toHaveBeenCalled();
    });

    it('declines for good, and reset forgets', async () => {
      await service.updatePrompt(7, 'decline', now);
      expect(prisma.feedbackPrompt.upsert).toHaveBeenCalledWith({
        where: { userId: 7 },
        create: { userId: 7, status: 'DECLINED' },
        update: { status: 'DECLINED', snoozedUntil: null },
      });

      await service.updatePrompt(7, 'reset', now);
      expect(prisma.feedbackPrompt.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    });
  });

  describe('createRating', () => {
    it('stores a rating report and ends the prompt', async () => {
      tx.report.create.mockResolvedValue({ id: 12 });

      const created = await service.createRating(7, {
        score: 3,
        role: 'PLAYER',
        origin: 'PROMPT',
        reasons: ['BUGS', 'BUGS', 'PERFORMANCE'],
        liked: '',
        improve: 'Loading',
        releaseId: 42,
      });

      expect(created).toEqual({ id: 12 });
      expect(tx.report.create).toHaveBeenCalledWith({
        data: {
          kind: 'RATING',
          userId: 7,
          role: 'PLAYER',
          score: 3,
          reasons: ['BUGS', 'PERFORMANCE'],
          liked: null,
          improve: 'Loading',
          origin: 'PROMPT',
          releaseId: 42,
        },
        select: { id: true },
      });
      expect(tx.feedbackPrompt.upsert).toHaveBeenCalledWith({
        where: { userId: 7 },
        create: { userId: 7, status: 'ANSWERED' },
        update: {},
      });
      expect(tx.feedbackPrompt.updateMany).toHaveBeenCalledWith({
        where: { userId: 7, status: 'SNOOZED' },
        data: { status: 'ANSWERED', snoozedUntil: null },
      });
    });
  });
});
