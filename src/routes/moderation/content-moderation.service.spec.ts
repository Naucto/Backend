import { NotFoundException } from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationReason } from '@prisma/client';

import { MODERATOR, USER } from '../../auth/access/roles';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentModerationService } from './content-moderation.service';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationLogService } from './moderation-log.service';

const MOD = { id: 1, role: MODERATOR } as const;
const DECISION = { reason: ModerationReason.SPAM };

describe('ContentModerationService', () => {
  const comment = (overrides: object = {}): object => ({
    id: 31,
    content: 'Buy my thing',
    deleted: false,
    hiddenAt: null,
    authorId: 7,
    ...overrides,
  });
  const account = (id: number, role: string): object => ({
    id,
    username: `user${String(id)}`,
    nickname: null,
    role,
    email: `user${String(id)}@example.com`,
    deletedAt: null,
  });
  const recorded = (action: ModerationActionType): object => ({
    id: 99,
    action,
    actor: account(1, MODERATOR),
    subject: account(7, USER),
    subjectUserId: 7,
    targetType: 'COMMENT',
    targetId: 31,
    reason: ModerationReason.SPAM,
    publicMessage: null,
    internalNote: null,
    snapshot: { title: null, body: 'Buy my thing' },
    expiresAt: null,
    createdAt: new Date('2026-11-19T12:00:00.000Z'),
  });

  const tx = { comment: { update: jest.fn() }, flag: { updateMany: jest.fn() } };
  const prisma = { comment: { findUnique: jest.fn() }, $transaction: jest.fn() };
  const log = { record: jest.fn() };
  const notifications = { notifyBestEffort: jest.fn() };
  let service: ContentModerationService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    prisma.comment.findUnique.mockResolvedValue(comment());
    tx.flag.updateMany.mockResolvedValue({ count: 1 });
    service = new ContentModerationService(
      prisma as unknown as PrismaService,
      log as unknown as ModerationLogService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('hideComment', () => {
    beforeEach(() => {
      log.record.mockResolvedValue(recorded(ModerationActionType.COMMENT_HIDDEN));
    });

    it('hides it, keeps its text as evidence and closes its flags, in one transaction', async () => {
      await service.hideComment(MOD, 31, DECISION);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.comment.update).toHaveBeenCalledWith({
        where: { id: 31 },
        data: { hiddenAt: expect.any(Date) },
      });
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.COMMENT_HIDDEN,
          targetId: 31,
          subjectUserId: 7,
          snapshot: { title: null, body: 'Buy my thing' },
        }),
      );
      expect(tx.flag.updateMany).toHaveBeenCalledWith({
        where: { targetType: 'COMMENT', targetId: 31, status: FlagStatus.OPEN },
        data: expect.objectContaining({ status: FlagStatus.ACTIONED, resolutionId: 99 }),
      });
    });

    it('never touches the text of the comment', async () => {
      await service.hideComment(MOD, 31, DECISION);

      expect(tx.comment.update.mock.calls[0][0].data).not.toHaveProperty('content');
    });

    it('tells the author, in the words of staff when there are some', async () => {
      await service.hideComment(MOD, 31, { ...DECISION, publicMessage: 'No advertising.' });

      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, kind: 'MODERATION', message: 'No advertising.' }),
      );
    });

    it.each([
      ['a user already deleted', { deleted: true }, MODERATION_ERROR.COMMENT_DELETED],
      ['is hidden already', { hiddenAt: new Date() }, MODERATION_ERROR.ALREADY_HIDDEN],
    ])('refuses a comment that %s', async (_case, state, code) => {
      prisma.comment.findUnique.mockResolvedValue(comment(state));

      await expect(service.hideComment(MOD, 31, DECISION)).rejects.toMatchObject({ code });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses staff deciding about their own comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(comment({ authorId: MOD.id }));

      await expect(service.hideComment(MOD, 31, DECISION)).rejects.toMatchObject({
        code: MODERATION_ERROR.OWN_CASE,
      });
    });

    it('finds no comment that does not exist', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.hideComment(MOD, 31, DECISION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hides nothing when the log row cannot be written', async () => {
      log.record.mockRejectedValue(new Error('database is down'));

      await expect(service.hideComment(MOD, 31, DECISION)).rejects.toThrow('database is down');
      expect(notifications.notifyBestEffort).not.toHaveBeenCalled();
    });
  });

  describe('restoreComment', () => {
    beforeEach(() => {
      log.record.mockResolvedValue(recorded(ModerationActionType.COMMENT_RESTORED));
    });

    it('refuses a comment that is not hidden', async () => {
      await expect(service.restoreComment(MOD, 31, {})).rejects.toMatchObject({
        code: MODERATION_ERROR.NOT_HIDDEN,
      });
    });

    it('puts it back as it was, records it and tells the author', async () => {
      prisma.comment.findUnique.mockResolvedValue(comment({ hiddenAt: new Date() }));

      await service.restoreComment(MOD, 31, {});

      expect(tx.comment.update).toHaveBeenCalledWith({
        where: { id: 31 },
        data: { hiddenAt: null },
      });
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: ModerationActionType.COMMENT_RESTORED }),
      );
      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, title: 'Your comment is back' }),
      );
    });
  });
});
