import { ConflictException, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { PROMPT_SNOOZE_MS, ReportsService } from './reports.service';

describe('ReportsService', () => {
  const tx = {
    report: { create: jest.fn() },
    feedbackPrompt: { findUnique: jest.fn(), upsert: jest.fn(), updateMany: jest.fn() },
  };
  const prisma = {
    ...tx,
    report: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    feedbackPrompt: { ...tx.feedbackPrompt, deleteMany: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const s3Service = { uploadFile: jest.fn() };
  const now = new Date('2026-10-24T12:00:00.000Z');
  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.feedbackPrompt.findUnique.mockResolvedValue(null);
    tx.feedbackPrompt.findUnique.mockResolvedValue(null);
    service = new ReportsService(
      prisma as unknown as PrismaService,
      s3Service as unknown as S3Service,
    );
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

  describe('createBugReport', () => {
    const bug = {
      category: 'SOUND' as const,
      title: 'No music',
      description: 'The song never starts.',
      route: '/play/42',
      releaseId: 42,
      ratingId: 12,
      appRelease: '0.1.0+8f78127',
      context: { viewport: '1280x720', console: ['[error] boom'] },
    };

    it('links the rating only when it is a rating of the reporter', async () => {
      prisma.report.findFirst.mockResolvedValue(null);
      prisma.report.create.mockResolvedValue({ id: 31 });

      await service.createBugReport(7, bug, 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0');

      expect(prisma.report.findFirst).toHaveBeenCalledWith({
        where: { id: 12, userId: 7, kind: 'RATING' },
        select: { id: true },
      });
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: 'BUG',
          userId: 7,
          category: 'SOUND',
          title: 'No music',
          message: 'The song never starts.',
          ratingId: null,
          appRelease: '0.1.0+8f78127',
          context: {
            viewport: '1280x720',
            console: ['[error] boom'],
            device: 'desktop',
            browser: 'Firefox',
            os: 'Linux',
          },
        }),
        select: { id: true },
      });
    });
  });

  describe('attachScreenshot', () => {
    const file = { mimetype: 'image/webp', size: 2048 } as Express.Multer.File;

    it('stores the file privately and records it on the report', async () => {
      prisma.report.findFirst.mockResolvedValue({ createdAt: now, screenshotKey: null });

      await service.attachScreenshot(7, 31, file, now);

      expect(s3Service.uploadFile).toHaveBeenCalledWith({
        file,
        keyName: 'reports/31/screenshot.webp',
        cacheControl: 'private, no-store',
      });
      expect(prisma.report.update).toHaveBeenCalledWith({
        where: { id: 31 },
        data: {
          screenshotKey: 'reports/31/screenshot.webp',
          screenshotMime: 'image/webp',
          screenshotBytes: 2048,
        },
      });
    });

    it('answers 404 for a report that is not a bug report of this account', async () => {
      prisma.report.findFirst.mockResolvedValue(null);

      await expect(service.attachScreenshot(8, 31, file, now)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(s3Service.uploadFile).not.toHaveBeenCalled();
    });

    it.each([
      ['a report that has one already', { createdAt: now, screenshotKey: 'reports/31/a.png' }],
      [
        'a report sent over an hour ago',
        { createdAt: new Date('2026-10-24T10:00:00.000Z'), screenshotKey: null },
      ],
    ])('refuses %s', async (_, row) => {
      prisma.report.findFirst.mockResolvedValue(row);

      await expect(service.attachScreenshot(7, 31, file, now)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(s3Service.uploadFile).not.toHaveBeenCalled();
    });
  });
});
