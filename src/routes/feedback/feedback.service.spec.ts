import { NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { FeaturesService } from '../features/features.service';
import { S3Service } from '../s3/s3.service';
import { FeedbackService, PROMPT_SNOOZE_MS } from './feedback.service';

describe('FeedbackService', () => {
  const prisma = {
    $transaction: jest.fn(),
    feedbackPrompt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    platformRating: { create: jest.fn(), findFirst: jest.fn() },
    bugReport: { create: jest.fn(), update: jest.fn() },
  };
  const features = { features: { monetization: false, analytics: false, feedback: true } };
  const s3Service = { uploadFile: jest.fn() };
  const now = new Date('2026-10-19T12:00:00.000Z');
  let service: FeedbackService;

  beforeEach(() => {
    jest.resetAllMocks();
    features.features.feedback = true;
    prisma.$transaction.mockImplementation((work: (tx: typeof prisma) => unknown) => work(prisma));
    prisma.platformRating.create.mockResolvedValue({ id: 5 });
    prisma.bugReport.create.mockResolvedValue({ id: 9 });
    service = new FeedbackService(
      prisma as unknown as PrismaService,
      features as unknown as FeaturesService,
      s3Service as unknown as S3Service,
    );
    jest.spyOn(service['logger'], 'warn').mockImplementation();
  });

  it('refuses while feedback is off', () => {
    features.features.feedback = false;

    expect(() => service.assertEnabled()).toThrow(NotFoundException);
  });

  describe('prompt', () => {
    const ASKABLE = { eligible: true, declined: false };

    it.each([
      ['never shown', null, ASKABLE],
      [
        'answered',
        { status: 'ANSWERED', snoozedUntil: null },
        { eligible: false, declined: false },
      ],
      ['declined', { status: 'DECLINED', snoozedUntil: null }, { eligible: false, declined: true }],
      [
        'snoozed until later',
        { status: 'SNOOZED', snoozedUntil: new Date(now.getTime() + 1) },
        { eligible: false, declined: false },
      ],
      [
        'snoozed until before now',
        { status: 'SNOOZED', snoozedUntil: new Date(now.getTime() - 1) },
        ASKABLE,
      ],
    ])('as a player, when %s, and still asks as a creator', async (_case, row, expected) => {
      prisma.feedbackPrompt.findMany.mockResolvedValue(row ? [{ context: 'PLAYER', ...row }] : []);

      await expect(service.promptState(7, now)).resolves.toEqual({
        player: expected,
        creator: ASKABLE,
      });
    });

    it('snoozes one context for 14 days', async () => {
      prisma.feedbackPrompt.findUnique.mockResolvedValue(null);
      prisma.feedbackPrompt.findMany.mockResolvedValue([]);

      await service.updatePrompt(7, 'snooze', 'CREATOR', now);

      const snoozedUntil = new Date(now.getTime() + PROMPT_SNOOZE_MS);
      expect(prisma.feedbackPrompt.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.feedbackPrompt.upsert).toHaveBeenCalledWith({
        where: { userId_context: { userId: 7, context: 'CREATOR' } },
        create: { userId: 7, context: 'CREATOR', status: 'SNOOZED', snoozedUntil },
        update: { status: 'SNOOZED', snoozedUntil },
      });
    });

    it('never turns an answer back into a snooze', async () => {
      prisma.feedbackPrompt.findUnique.mockResolvedValue({ status: 'ANSWERED' });
      prisma.feedbackPrompt.findMany.mockResolvedValue([]);

      await service.updatePrompt(7, 'snooze', 'PLAYER', now);

      expect(prisma.feedbackPrompt.upsert).not.toHaveBeenCalled();
    });

    it('declines and resets both contexts when none is named', async () => {
      prisma.feedbackPrompt.findMany.mockResolvedValue([]);
      prisma.$transaction.mockImplementation((work: unknown) =>
        typeof work === 'function'
          ? (work as (tx: typeof prisma) => unknown)(prisma)
          : Promise.all(work as unknown[]),
      );

      await service.updatePrompt(7, 'decline', undefined, now);
      expect(prisma.feedbackPrompt.upsert).toHaveBeenCalledTimes(2);

      await service.updatePrompt(7, 'reset', undefined, now);
      expect(prisma.feedbackPrompt.deleteMany).toHaveBeenCalledWith({
        where: { userId: 7, context: { in: ['PLAYER', 'CREATOR'] } },
      });
    });
  });

  it('stores a rating with empty comments as none, and ends a snoozed prompt', async () => {
    await expect(
      service.createRating(7, {
        score: 3,
        reasons: ['BUGS', 'BUGS', 'PERFORMANCE'],
        liked: '',
        improve: 'Loading is slow',
        context: 'PLAYER',
        source: 'PROMPT',
        releaseId: 42,
      }),
    ).resolves.toEqual({ id: 5 });

    expect(prisma.platformRating.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 7,
        score: 3,
        reasons: ['BUGS', 'PERFORMANCE'],
        liked: null,
        improve: 'Loading is slow',
        releaseId: 42,
      }),
      select: { id: true },
    });
    expect(prisma.feedbackPrompt.upsert).toHaveBeenCalledWith({
      where: { userId_context: { userId: 7, context: 'PLAYER' } },
      create: { userId: 7, context: 'PLAYER', status: 'ANSWERED' },
      update: {},
    });
    expect(prisma.feedbackPrompt.updateMany).toHaveBeenCalledWith({
      where: { userId: 7, context: 'PLAYER', status: 'SNOOZED' },
      data: { status: 'ANSWERED', snoozedUntil: null },
    });
  });

  describe('bug reports', () => {
    const report = {
      category: 'GAMEPLAY' as const,
      title: 'Jump is stuck',
      description: 'Pressing jump twice freezes the player.',
      route: '/play/42',
    };
    const screenshot = {
      mimetype: 'image/webp',
      size: 1234,
      originalname: 'shot.webp',
    } as Express.Multer.File;

    it('links a rating only when it is the reporter’s own', async () => {
      prisma.platformRating.findFirst.mockResolvedValue(null);

      await service.createBugReport(7, { ...report, ratingId: 99 }, undefined, undefined);

      expect(prisma.platformRating.findFirst).toHaveBeenCalledWith({
        where: { id: 99, userId: 7 },
        select: { id: true },
      });
      expect(prisma.bugReport.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ratingId: null }) }),
      );
    });

    it('stores the screenshot privately under the report', async () => {
      await service.createBugReport(7, report, undefined, screenshot);

      expect(s3Service.uploadFile).toHaveBeenCalledWith({
        file: screenshot,
        keyName: 'feedback/bugs/9/screenshot.webp',
        cacheControl: 'private, no-store',
      });
      expect(prisma.bugReport.update).toHaveBeenCalledWith({
        where: { id: 9 },
        data: {
          screenshotKey: 'feedback/bugs/9/screenshot.webp',
          screenshotMime: 'image/webp',
          screenshotBytes: 1234,
        },
      });
    });

    it('keeps the report when its screenshot cannot be stored', async () => {
      s3Service.uploadFile.mockRejectedValue(new Error('store down'));

      await expect(service.createBugReport(7, report, undefined, screenshot)).resolves.toEqual({
        id: 9,
      });
      expect(prisma.bugReport.update).not.toHaveBeenCalled();
    });
  });
});
