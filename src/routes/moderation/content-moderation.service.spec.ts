import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FlagStatus, ModerationActionType, ModerationReason } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { MODERATOR, USER } from '../../auth/access/roles';
import { PROJECT_CHANGED, ProjectChangedEvent } from '../../common/domain-events';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MultiplayerService } from '../multiplayer/multiplayer.service';
import { ProjectService } from '../project/project.service';
import { ProjectContentService } from '../project/project-content.service';
import { ContentModerationService } from './content-moderation.service';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationLogService } from './moderation-log.service';

const MOD = { id: uuidOf(1), role: MODERATOR } as const;
const DECISION = { reason: ModerationReason.SPAM };

describe('ContentModerationService', () => {
  const comment = (overrides: object = {}): object => ({
    id: uuidOf(31),
    content: 'Buy my thing',
    deleted: false,
    hiddenAt: null,
    authorId: uuidOf(7),
    ...overrides,
  });
  const account = (number: number, role: string): object => ({
    id: uuidOf(number),
    username: `user${String(number)}`,
    nickname: null,
    role,
    email: `user${String(number)}@example.com`,
    deletedAt: null,
  });
  const recorded = (action: ModerationActionType): object => ({
    id: uuidOf(99),
    action,
    actor: account(1, MODERATOR),
    subject: account(7, USER),
    subjectUserId: uuidOf(7),
    targetType: 'COMMENT',
    targetId: uuidOf(31),
    reason: ModerationReason.SPAM,
    publicMessage: null,
    internalNote: null,
    snapshot: { title: null, body: 'Buy my thing' },
    expiresAt: null,
    createdAt: new Date('2026-11-19T12:00:00.000Z'),
  });

  const game = (overrides: object = {}): object => ({
    id: uuidOf(12),
    userId: uuidOf(7),
    name: 'Draft name',
    shortDesc: 'Draft blurb',
    longDesc: null,
    publishedName: 'Ferry Click',
    publishedShortDesc: 'Click the ferry',
    publishedLongDesc: 'A longer text',
    hiddenAt: null,
    ...overrides,
  });

  const tx = {
    comment: { update: jest.fn() },
    project: { updateMany: jest.fn() },
    flag: { updateMany: jest.fn() },
  };
  const prisma = {
    comment: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const log = { record: jest.fn() };
  const notifications = { notifyBestEffort: jest.fn() };
  const content = {
    copyToWithheld: jest.fn(),
    removeServedCopies: jest.fn(),
    copyFromWithheld: jest.fn(),
    removeWithheldCopies: jest.fn(),
  };
  const multiplayer = { endSessionsOfProject: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const projects = { remove: jest.fn() };
  let service: ContentModerationService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    prisma.comment.findUnique.mockResolvedValue(comment());
    prisma.project.findUnique.mockResolvedValue(game());
    tx.flag.updateMany.mockResolvedValue({ count: 1 });
    tx.project.updateMany.mockResolvedValue({ count: 1 });
    service = new ContentModerationService(
      prisma as unknown as PrismaService,
      log as unknown as ModerationLogService,
      notifications as unknown as NotificationsService,
      content as unknown as ProjectContentService,
      projects as unknown as ProjectService,
      multiplayer as unknown as MultiplayerService,
      eventEmitter as unknown as EventEmitter2,
    );
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  describe('removeProject', () => {
    beforeEach(() => {
      log.record.mockResolvedValue({
        ...(recorded(ModerationActionType.PROJECT_DELETED) as object),
        targetType: 'PROJECT',
        targetId: uuidOf(12),
      });
      projects.remove.mockImplementation(
        async (_id: number, alongside: (client: typeof tx) => unknown) => {
          await alongside(tx);
        },
      );
    });

    it('deletes the game as its creator could, recording it in the same transaction', async () => {
      await service.removeProject(MOD, uuidOf(12), DECISION);

      expect(projects.remove).toHaveBeenCalledWith(uuidOf(12), expect.any(Function));
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.PROJECT_DELETED,
          targetId: uuidOf(12),
          subjectUserId: uuidOf(7),
          snapshot: { title: 'Ferry Click', body: 'Click the ferry\n\nA longer text' },
        }),
      );
      expect(tx.flag.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { targetType: 'PROJECT', targetId: uuidOf(12), status: FlagStatus.OPEN },
        }),
      );
    });

    it('tells its creator', async () => {
      await service.removeProject(MOD, uuidOf(12), DECISION);

      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(7), title: 'Your game was deleted' }),
      );
    });

    it('tells nobody when the game was not deleted', async () => {
      projects.remove.mockRejectedValue(new Error('database is down'));

      await expect(service.removeProject(MOD, uuidOf(12), DECISION)).rejects.toThrow(
        'database is down',
      );
      expect(notifications.notifyBestEffort).not.toHaveBeenCalled();
    });
  });

  describe('removeComment', () => {
    const txComments = { count: jest.fn(), update: jest.fn(), delete: jest.fn() };

    beforeEach(() => {
      Object.assign(tx.comment, txComments);
      txComments.count.mockResolvedValue(0);
      log.record.mockResolvedValue(recorded(ModerationActionType.COMMENT_DELETED));
    });

    it('deletes a comment nobody replied to, keeping its text in the log only', async () => {
      await service.removeComment(MOD, uuidOf(31), DECISION);

      expect(txComments.delete).toHaveBeenCalledWith({ where: { id: uuidOf(31) } });
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.COMMENT_DELETED,
          snapshot: { title: null, body: 'Buy my thing' },
        }),
      );
    });

    it('empties a comment that has replies, so they keep their place', async () => {
      txComments.count.mockResolvedValue(2);

      await service.removeComment(MOD, uuidOf(31), DECISION);

      expect(txComments.delete).not.toHaveBeenCalled();
      expect(tx.comment.update).toHaveBeenCalledWith({
        where: { id: uuidOf(31) },
        data: { deleted: true, content: '', hiddenAt: expect.any(Date) },
      });
    });
  });

  describe('hideProject', () => {
    beforeEach(() => {
      log.record.mockResolvedValue({
        ...(recorded(ModerationActionType.PROJECT_HIDDEN) as object),
        targetType: 'PROJECT',
        targetId: uuidOf(12),
      });
    });

    it('copies the release out of reach, marks the row, then removes what is served', async () => {
      await service.hideProject(MOD, uuidOf(12), DECISION);

      const order = [
        content.copyToWithheld.mock.invocationCallOrder[0]!,
        tx.project.updateMany.mock.invocationCallOrder[0]!,
        content.removeServedCopies.mock.invocationCallOrder[0]!,
      ];
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(tx.project.updateMany).toHaveBeenCalledWith({
        where: { id: uuidOf(12), hiddenAt: null },
        data: { hiddenAt: expect.any(Date), iconUrl: null, clipVersion: null },
      });
    });

    it('records the game as its page read, for its creator to find in their standing', async () => {
      await service.hideProject(MOD, uuidOf(12), DECISION);

      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.PROJECT_HIDDEN,
          targetId: uuidOf(12),
          subjectUserId: uuidOf(7),
          snapshot: { title: 'Ferry Click', body: 'Click the ferry\n\nA longer text' },
        }),
      );
    });

    it('ends the live sessions of the game and tells who watches it', async () => {
      await service.hideProject(MOD, uuidOf(12), DECISION);

      expect(multiplayer.endSessionsOfProject).toHaveBeenCalledWith(uuidOf(12));
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        PROJECT_CHANGED,
        new ProjectChangedEvent(uuidOf(12)),
      );
      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(7), title: 'Your game was hidden' }),
      );
    });

    it('stays hidden when what is served could not be removed', async () => {
      content.removeServedCopies.mockRejectedValue(new Error('storage is down'));

      await expect(service.hideProject(MOD, uuidOf(12), DECISION)).resolves.toBeDefined();
    });

    it('removes nothing that is served when the row could not be marked', async () => {
      log.record.mockRejectedValue(new Error('database is down'));

      await expect(service.hideProject(MOD, uuidOf(12), DECISION)).rejects.toThrow(
        'database is down',
      );
      expect(content.removeServedCopies).not.toHaveBeenCalled();
    });

    it.each([
      [
        'is hidden already',
        () => prisma.project.findUnique.mockResolvedValue(game({ hiddenAt: new Date() })),
      ],
      [
        'another staff member hid meanwhile',
        () => tx.project.updateMany.mockResolvedValue({ count: 0 }),
      ],
    ])('refuses a game that %s', async (_case, arrange) => {
      arrange();

      await expect(service.hideProject(MOD, uuidOf(12), DECISION)).rejects.toMatchObject({
        code: MODERATION_ERROR.ALREADY_HIDDEN,
      });
      expect(log.record).not.toHaveBeenCalled();
    });

    it('refuses staff deciding about a game they created', async () => {
      prisma.project.findUnique.mockResolvedValue(game({ userId: MOD.id }));

      await expect(service.hideProject(MOD, uuidOf(12), DECISION)).rejects.toMatchObject({
        code: MODERATION_ERROR.OWN_CASE,
      });
      expect(content.copyToWithheld).not.toHaveBeenCalled();
    });
  });

  describe('restoreProject', () => {
    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue(game({ hiddenAt: new Date() }));
      content.copyFromWithheld.mockResolvedValue({
        coverUrl: `https://cdn.test/projects/${uuidOf(12)}/image`,
        clipVersion: '"c11p"',
      });
      log.record.mockResolvedValue({
        ...(recorded(ModerationActionType.PROJECT_RESTORED) as object),
        targetType: 'PROJECT',
        targetId: uuidOf(12),
      });
    });

    it('refuses a game that is not hidden', async () => {
      prisma.project.findUnique.mockResolvedValue(game());

      await expect(service.restoreProject(MOD, uuidOf(12), {})).rejects.toMatchObject({
        code: MODERATION_ERROR.NOT_HIDDEN,
      });
      expect(content.copyFromWithheld).not.toHaveBeenCalled();
    });

    it('puts the release, the cover and the clip back, then drops the withheld copies', async () => {
      await service.restoreProject(MOD, uuidOf(12), {});

      expect(tx.project.updateMany).toHaveBeenCalledWith({
        where: { id: uuidOf(12), hiddenAt: { not: null } },
        data: {
          hiddenAt: null,
          iconUrl: `https://cdn.test/projects/${uuidOf(12)}/image`,
          clipVersion: '"c11p"',
        },
      });
      expect(content.removeWithheldCopies).toHaveBeenCalledWith(uuidOf(12));
      expect(content.removeServedCopies).not.toHaveBeenCalled();
    });

    it('names no cover and no clip on the row of a game that had none', async () => {
      content.copyFromWithheld.mockResolvedValue({ coverUrl: null, clipVersion: null });

      await service.restoreProject(MOD, uuidOf(12), {});

      expect(tx.project.updateMany).toHaveBeenCalledWith({
        where: { id: uuidOf(12), hiddenAt: { not: null } },
        data: { hiddenAt: null },
      });
    });

    it('takes the release back out of reach when the row could not be cleared', async () => {
      log.record.mockRejectedValue(new Error('database is down'));

      await expect(service.restoreProject(MOD, uuidOf(12), {})).rejects.toThrow('database is down');
      expect(content.removeServedCopies).toHaveBeenCalledWith(uuidOf(12));
      expect(content.removeWithheldCopies).not.toHaveBeenCalled();
    });
  });

  describe('hideComment', () => {
    beforeEach(() => {
      log.record.mockResolvedValue(recorded(ModerationActionType.COMMENT_HIDDEN));
    });

    it('hides it, keeps its text as evidence and closes its flags, in one transaction', async () => {
      await service.hideComment(MOD, uuidOf(31), DECISION);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.comment.update).toHaveBeenCalledWith({
        where: { id: uuidOf(31) },
        data: { hiddenAt: expect.any(Date) },
      });
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.COMMENT_HIDDEN,
          targetId: uuidOf(31),
          subjectUserId: uuidOf(7),
          snapshot: { title: null, body: 'Buy my thing' },
        }),
      );
      expect(tx.flag.updateMany).toHaveBeenCalledWith({
        where: { targetType: 'COMMENT', targetId: uuidOf(31), status: FlagStatus.OPEN },
        data: expect.objectContaining({ status: FlagStatus.ACTIONED, resolutionId: uuidOf(99) }),
      });
    });

    it('never touches the text of the comment', async () => {
      await service.hideComment(MOD, uuidOf(31), DECISION);

      expect(tx.comment.update.mock.calls[0][0].data).not.toHaveProperty('content');
    });

    it('tells the author, in the words of staff when there are some', async () => {
      await service.hideComment(MOD, uuidOf(31), { ...DECISION, publicMessage: 'No advertising.' });

      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuidOf(7),
          kind: 'MODERATION',
          message: 'No advertising.',
        }),
      );
    });

    it.each([
      ['a user already deleted', { deleted: true }, MODERATION_ERROR.COMMENT_DELETED],
      ['is hidden already', { hiddenAt: new Date() }, MODERATION_ERROR.ALREADY_HIDDEN],
    ])('refuses a comment that %s', async (_case, state, code) => {
      prisma.comment.findUnique.mockResolvedValue(comment(state));

      await expect(service.hideComment(MOD, uuidOf(31), DECISION)).rejects.toMatchObject({ code });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses staff deciding about their own comment', async () => {
      prisma.comment.findUnique.mockResolvedValue(comment({ authorId: MOD.id }));

      await expect(service.hideComment(MOD, uuidOf(31), DECISION)).rejects.toMatchObject({
        code: MODERATION_ERROR.OWN_CASE,
      });
    });

    it('finds no comment that does not exist', async () => {
      prisma.comment.findUnique.mockResolvedValue(null);

      await expect(service.hideComment(MOD, uuidOf(31), DECISION)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hides nothing when the log row cannot be written', async () => {
      log.record.mockRejectedValue(new Error('database is down'));

      await expect(service.hideComment(MOD, uuidOf(31), DECISION)).rejects.toThrow(
        'database is down',
      );
      expect(notifications.notifyBestEffort).not.toHaveBeenCalled();
    });
  });

  describe('restoreComment', () => {
    beforeEach(() => {
      log.record.mockResolvedValue(recorded(ModerationActionType.COMMENT_RESTORED));
    });

    it('refuses a comment that is not hidden', async () => {
      await expect(service.restoreComment(MOD, uuidOf(31), {})).rejects.toMatchObject({
        code: MODERATION_ERROR.NOT_HIDDEN,
      });
    });

    it('puts it back as it was, records it and tells the author', async () => {
      prisma.comment.findUnique.mockResolvedValue(comment({ hiddenAt: new Date() }));

      await service.restoreComment(MOD, uuidOf(31), {});

      expect(tx.comment.update).toHaveBeenCalledWith({
        where: { id: uuidOf(31) },
        data: { hiddenAt: null },
      });
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: ModerationActionType.COMMENT_RESTORED }),
      );
      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(7), title: 'Your comment is back' }),
      );
    });
  });
});
