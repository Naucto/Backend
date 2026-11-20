import { NotFoundException } from '@nestjs/common';
import { FlagStatus, ModerationActionType, ModerationReason } from '@prisma/client';

import { ADMIN, MODERATOR, RoleName, USER } from '../../auth/access/roles';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MultiplayerService } from '../multiplayer/multiplayer.service';
import { AccountDeletionService } from '../user/account-deletion.service';
import { ProfileAssetService } from '../user/profile-asset.service';
import { WorkSessionService } from '../work-session/work-session.service';
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

  const tx = { flag: { updateMany: jest.fn() }, user: { update: jest.fn() } };
  const prisma = {
    user: { findUnique: jest.fn() },
    $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  };
  const log = { record: jest.fn() };
  const notifications = { notifyBestEffort: jest.fn() };
  const multiplayer = { removeAccount: jest.fn() };
  const workSessions = { kickEverywhere: jest.fn() };
  const deletion = { deleteAccount: jest.fn() };
  const profileAssets = { remove: jest.fn() };
  let service: AccountModerationService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
    prisma.user.findUnique.mockResolvedValue(target(USER));
    log.record.mockResolvedValue(recorded);
    tx.flag.updateMany.mockResolvedValue({ count: 2 });
    notifications.notifyBestEffort.mockResolvedValue(undefined);
    service = new AccountModerationService(
      prisma as unknown as PrismaService,
      log as unknown as ModerationLogService,
      notifications as unknown as NotificationsService,
      multiplayer as unknown as MultiplayerService,
      workSessions as unknown as WorkSessionService,
      deletion as unknown as AccountDeletionService,
      profileAssets as unknown as ProfileAssetService,
    );
  });

  describe('clearProfile', () => {
    const CLEAR = { reason: ModerationReason.SEXUAL_CONTENT };

    beforeEach(() => {
      log.record.mockResolvedValue({ ...recorded, action: ModerationActionType.PROFILE_CLEARED });
    });

    it('clears only the parts asked for', async () => {
      await service.clearProfile(MOD, 7, { ...CLEAR, parts: ['PICTURE', 'DESCRIPTION'] });

      expect(profileAssets.remove.mock.calls).toEqual([[7, 'profile']]);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { description: null },
      });
    });

    it('records the profile as it read before, for the account to find in its standing', async () => {
      await service.clearProfile(MOD, 7, { ...CLEAR, parts: ['NICKNAME'] });

      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.PROFILE_CLEARED,
          snapshot: { title: 'Louis', body: 'Makes games' },
        }),
      );
      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, title: 'Your profile was edited' }),
      );
    });

    it('records nothing when a picture could not be removed', async () => {
      profileAssets.remove.mockRejectedValue(new Error('storage is down'));

      await expect(
        service.clearProfile(MOD, 7, { ...CLEAR, parts: ['BACKGROUND'] }),
      ).rejects.toThrow('storage is down');
      expect(log.record).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    const ERASE = {
      reason: ModerationReason.ILLEGAL,
      confirmation: 'DELETE' as const,
      removePublishedGames: true,
    };
    const BOSS = { id: 2, role: ADMIN } as const;

    beforeEach(() => {
      log.record.mockResolvedValue({ ...recorded, action: ModerationActionType.ACCOUNT_DELETED });
      deletion.deleteAccount.mockImplementation(
        async (
          _id: number,
          _games: boolean,
          _by: object,
          alongside: (client: typeof tx) => unknown,
        ) => {
          await alongside(tx);
        },
      );
    });

    it('erases the account as its owner could, and records it in the same transaction', async () => {
      await service.remove(BOSS, 7, ERASE);

      expect(deletion.deleteAccount).toHaveBeenCalledWith(
        7,
        true,
        { by: 'admin' },
        expect.any(Function),
      );
      expect(log.record).toHaveBeenCalledWith(tx, {
        action: ModerationActionType.ACCOUNT_DELETED,
        actorId: BOSS.id,
        targetType: 'USER',
        targetId: 7,
        subjectUserId: 7,
        reason: ModerationReason.ILLEGAL,
        internalNote: undefined,
      });
    });

    it('keeps no copy of the profile it erases', async () => {
      await service.remove(BOSS, 7, ERASE);

      expect(log.record.mock.calls[0][1]).not.toHaveProperty('snapshot');
    });

    it('tells nobody: there is no account left to tell', async () => {
      await service.remove(BOSS, 7, ERASE);

      expect(notifications.notifyBestEffort).not.toHaveBeenCalled();
    });

    it('never erases an account of equal rank, nor the caller', async () => {
      prisma.user.findUnique.mockResolvedValue(target(ADMIN));

      await expect(service.remove(BOSS, 7, ERASE)).rejects.toMatchObject({
        code: MODERATION_ERROR.TARGET_OUTRANKS_ACTOR,
      });
      await expect(service.remove(BOSS, BOSS.id, ERASE)).rejects.toMatchObject({
        code: MODERATION_ERROR.CANNOT_MODERATE_SELF,
      });
      expect(deletion.deleteAccount).not.toHaveBeenCalled();
    });
  });

  describe('suspend', () => {
    const SUSPENSION = { reason: ModerationReason.HARASSMENT, publicMessage: 'Repeated insults.' };

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-11-19T12:00:00.000Z') });
      log.record.mockResolvedValue({
        ...recorded,
        action: ModerationActionType.ACCOUNT_SUSPENDED,
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('suspends for the days asked, and records when it ends, in one transaction', async () => {
      await service.suspend(MOD, 7, { ...SUSPENSION, durationDays: 7 });

      const until = new Date('2026-11-26T12:00:00.000Z');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { suspendedAt: new Date('2026-11-19T12:00:00.000Z'), suspendedUntil: until },
      });
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: ModerationActionType.ACCOUNT_SUSPENDED,
          subjectUserId: 7,
          expiresAt: until,
        }),
      );
    });

    it('suspends until reinstated when no duration is given', async () => {
      await service.suspend(MOD, 7, SUSPENSION);

      expect(tx.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ suspendedUntil: null }) }),
      );
    });

    it('takes the account out of its live sessions once the suspension is written', async () => {
      await service.suspend(MOD, 7, SUSPENSION);

      expect(multiplayer.removeAccount).toHaveBeenCalledWith(7);
      expect(workSessions.kickEverywhere).toHaveBeenCalledWith(7);
      expect(tx.user.update.mock.invocationCallOrder[0]).toBeLessThan(
        multiplayer.removeAccount.mock.invocationCallOrder[0]!,
      );
    });

    it('stands even when a live session could not be ended', async () => {
      multiplayer.removeAccount.mockRejectedValue(new Error('room server is down'));
      jest.spyOn(service['logger'], 'warn').mockImplementation();

      await expect(service.suspend(MOD, 7, SUSPENSION)).resolves.toBeDefined();
      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, title: 'Your account is suspended' }),
      );
    });

    it('touches no session when the suspension could not be written', async () => {
      tx.user.update.mockRejectedValue(new Error('database is down'));

      await expect(service.suspend(MOD, 7, SUSPENSION)).rejects.toThrow('database is down');
      expect(multiplayer.removeAccount).not.toHaveBeenCalled();
    });
  });

  describe('reinstate', () => {
    it('refuses an account that is not suspended', async () => {
      await expect(service.reinstate(MOD, 7, {})).rejects.toMatchObject({
        code: MODERATION_ERROR.NOT_SUSPENDED,
      });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('refuses one whose suspension already ran out', async () => {
      prisma.user.findUnique.mockResolvedValue(
        target(USER, {
          suspendedAt: new Date('2020-01-01'),
          suspendedUntil: new Date('2020-01-02'),
        }),
      );

      await expect(service.reinstate(MOD, 7, {})).rejects.toMatchObject({
        code: MODERATION_ERROR.NOT_SUSPENDED,
      });
    });

    it('lifts the suspension, records it and tells the account', async () => {
      prisma.user.findUnique.mockResolvedValue(target(USER, { suspendedAt: new Date() }));
      log.record.mockResolvedValue({
        ...recorded,
        action: ModerationActionType.ACCOUNT_REINSTATED,
      });

      await service.reinstate(MOD, 7, {});

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { suspendedAt: null, suspendedUntil: null },
      });
      expect(log.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: ModerationActionType.ACCOUNT_REINSTATED }),
      );
      expect(notifications.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Your suspension was lifted.' }),
      );
    });
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
