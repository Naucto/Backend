import { NotFoundException } from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationReason } from '@prisma/client';

import { ADMIN, MODERATOR, RoleName, USER } from '../../auth/access/roles';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountModerationService } from './account-moderation.service';
import { MODERATION_ERROR } from './moderation.error';
import { ModerationLogService } from './moderation-log.service';

const MOD = { id: 1, role: MODERATOR } as const;

const WARNING = { reason: ModerationReason.HARASSMENT, publicMessage: 'Be kind in comments.' };

describe('AccountModerationService', () => {
  const target = (role: RoleName, overrides: object = {}): object => ({
    id: 7,
    username: 'louis',
    nickname: 'Louis',
    role,
    email: 'louis@example.com',
    deletedAt: null,
    description: 'Makes games',
    ...overrides,
  });
  const recorded = {
    id: 99,
    action: ModerationActionType.ACCOUNT_WARNED,
    actor: target(MODERATOR, { id: 1, username: 'mia' }),
    subject: target(USER),
    targetType: 'USER',
    targetId: 7,
    reason: ModerationReason.HARASSMENT,
    publicMessage: WARNING.publicMessage,
    internalNote: null,
    snapshot: { title: 'Louis', body: 'Makes games' },
    expiresAt: null,
    createdAt: new Date('2026-11-19T12:00:00.000Z'),
  };

  const tx = { flag: { updateMany: jest.fn() } };
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const log = { record: jest.fn() };
  const notifications = { notifyBestEffort: jest.fn() };
  let service: AccountModerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(target(USER));
    log.record.mockResolvedValue(recorded);
    tx.flag.updateMany.mockResolvedValue({ count: 2 });
    notifications.notifyBestEffort.mockResolvedValue(undefined);
    service = new AccountModerationService(
      prisma as unknown as PrismaService,
      log as unknown as ModerationLogService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('who may decide about whom', () => {
    it('refuses staff acting on their own account, before reading anything', async () => {
      await expect(service.warn(MOD, MOD.id, WARNING)).rejects.toMatchObject({
        code: MODERATION_ERROR.CANNOT_MODERATE_SELF,
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it.each<[string, RoleName, RoleName]>([
      ['a moderator on a moderator', MODERATOR, MODERATOR],
      ['a moderator on an admin', MODERATOR, ADMIN],
      ['an admin on an admin', ADMIN, ADMIN],
    ])('refuses %s', async (_case, actorRole, targetRole) => {
      prisma.user.findUnique.mockResolvedValue(target(targetRole));

      await expect(service.warn({ id: 1, role: actorRole }, 7, WARNING)).rejects.toMatchObject({
        code: MODERATION_ERROR.TARGET_OUTRANKS_ACTOR,
      });
      expect(log.record).not.toHaveBeenCalled();
    });

    it('lets an admin act on a moderator', async () => {
      prisma.user.findUnique.mockResolvedValue(target(MODERATOR));

      await expect(service.warn({ id: 1, role: ADMIN }, 7, WARNING)).resolves.toBeDefined();
    });

    it.each([
      ['does not exist', null],
      ['was erased', target(USER, { deletedAt: new Date() })],
    ])('finds no account when it %s', async (_case, row) => {
      prisma.user.findUnique.mockResolvedValue(row);

      await expect(service.warn(MOD, 7, WARNING)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('warn', () => {
    it('records the warning with the profile as it read, in one transaction with its flags', async () => {
      await service.warn(MOD, 7, { ...WARNING, internalNote: 'Third report this week' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(log.record).toHaveBeenCalledWith(tx, {
        action: ModerationActionType.ACCOUNT_WARNED,
        actorId: MOD.id,
        targetType: 'USER',
        targetId: 7,
        subjectUserId: 7,
        reason: ModerationReason.HARASSMENT,
        publicMessage: WARNING.publicMessage,
        internalNote: 'Third report this week',
        snapshot: { title: 'Louis', body: 'Makes games' },
      });
      expect(tx.flag.updateMany).toHaveBeenCalledWith({
        where: { targetType: 'USER', targetId: 7, status: FlagStatus.OPEN },
        data: expect.objectContaining({
          status: FlagStatus.ACTIONED,
          openKey: null,
          resolvedById: MOD.id,
          resolutionId: recorded.id,
        }),
      });
    });

    it('leaves the flags open when asked to', async () => {
      await service.warn(MOD, 7, { ...WARNING, resolveFlags: false });

      expect(tx.flag.updateMany).not.toHaveBeenCalled();
    });

    it('fails as a whole when the log row cannot be written', async () => {
      log.record.mockRejectedValue(new Error('database is down'));

      await expect(service.warn(MOD, 7, WARNING)).rejects.toThrow('database is down');
      expect(notifications.notifyBestEffort).not.toHaveBeenCalled();
    });

    it('tells the account, with what staff wrote to it', async () => {
      await service.warn(MOD, 7, WARNING);

      expect(notifications.notifyBestEffort).toHaveBeenCalledWith({
        userId: 7,
        title: 'You received a warning',
        message: WARNING.publicMessage,
        type: 'WARNING',
        kind: 'MODERATION',
        data: { actionId: recorded.id, action: ModerationActionType.ACCOUNT_WARNED },
      });
    });

    it('answers with the log row, without the address a moderator does not read', async () => {
      const action = await service.warn(MOD, 7, WARNING);

      expect(action).toMatchObject({ id: recorded.id, targetLabel: 'Louis' });
      expect(action.subject?.email).toBeNull();
    });
  });
});
