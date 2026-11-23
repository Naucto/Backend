import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { uuidOf } from '../../../test/uuid';
import { USER } from '../../auth/access/roles';
import {
  ACTIVITY_CHANGED,
  ActivityChangedEvent,
  FRIENDSHIP_CHANGED,
  FriendshipChangedEvent,
} from '../../common/domain-events';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsErasureService } from '../analytics/analytics-erasure.service';
import { ModerationLogService } from '../moderation/moderation-log.service';
import { ProjectService } from '../project/project.service';
import { EdgeService } from '../s3/edge.service';
import { S3Service } from '../s3/s3.service';
import { AccountDeletionService, USER_RELATION_FATES } from './account-deletion.service';
import { ProfileAssetService } from './profile-asset.service';

jest.mock('bcryptjs', () => ({ compare: jest.fn() }));

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  const prisma = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn() },
    project: { findMany: jest.fn() },
    gameSession: { deleteMany: jest.fn(), updateMany: jest.fn() },
    workSession: { deleteMany: jest.fn(), findMany: jest.fn() },
    refreshToken: { deleteMany: jest.fn() },
    friendship: { deleteMany: jest.fn(), findMany: jest.fn() },
    friendRequest: { deleteMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
    feedbackPrompt: { deleteMany: jest.fn() },
    collection: { deleteMany: jest.fn() },
    report: { findMany: jest.fn(), updateMany: jest.fn() },
  };
  const projectService = { remove: jest.fn() };
  const analyticsErasure = { eraseWithin: jest.fn() };
  const s3Service = { deleteFile: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const moderationLog = { scrubAccount: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    // Array-style transactions hold already "queued" mocks, so resolving is enough; an interactive
    // one runs its callback against the same mocks.
    prisma.$transaction.mockImplementation((operations: unknown) =>
      typeof operations === 'function' ? operations(prisma) : Promise.resolve([]),
    );
    prisma.user.findUnique.mockResolvedValue({ id: uuidOf(7), password: null, deletedAt: null });
    prisma.project.findMany.mockResolvedValue([]);
    prisma.friendship.findMany.mockResolvedValue([]);
    prisma.workSession.findMany.mockResolvedValue([]);
    prisma.report.findMany.mockResolvedValue([]);
    s3Service.deleteFile.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
        { provide: AnalyticsErasureService, useValue: analyticsErasure },
        ProfileAssetService,
        { provide: S3Service, useValue: s3Service },
        { provide: EdgeService, useValue: {} },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: ModerationLogService, useValue: moderationLog },
      ],
    }).compile();

    service = module.get(AccountDeletionService);
  });

  it('takes what the moderation record kept of the person, in the transaction that erases them', async () => {
    await service.deleteAccount(uuidOf(7), false, { by: 'self' });

    expect(moderationLog.scrubAccount).toHaveBeenCalledWith(prisma, uuidOf(7));
    expect(prisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      moderationLog.scrubAccount.mock.invocationCallOrder[0]!,
    );
  });

  it('runs what a caller records alongside last, on the same transaction', async () => {
    const alongside = jest.fn();

    await service.deleteAccount(uuidOf(7), false, { by: 'admin' }, alongside);

    expect(alongside).toHaveBeenCalledWith(prisma);
    expect(moderationLog.scrubAccount.mock.invocationCallOrder[0]).toBeLessThan(
      alongside.mock.invocationCallOrder[0]!,
    );
  });

  it('erases nothing when what was to be recorded alongside fails', async () => {
    await expect(
      service.deleteAccount(uuidOf(7), false, { by: 'admin' }, () =>
        Promise.reject(new Error('log is down')),
      ),
    ).rejects.toThrow('log is down');
    expect(s3Service.deleteFile).not.toHaveBeenCalled();
  });

  it('404s for an unknown or already deleted user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteAccount(uuidOf(7), false, { by: 'self' })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.user.findUnique.mockResolvedValueOnce({
      id: uuidOf(7),
      password: null,
      deletedAt: new Date(),
    });
    await expect(service.deleteAccount(uuidOf(7), false, { by: 'self' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('asks a password account for its password, and refuses a wrong one', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: uuidOf(7), password: 'hash', deletedAt: null });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.deleteAccount(uuidOf(7), false, { by: 'self' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.deleteAccount(uuidOf(7), false, { by: 'self', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();

    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    await expect(
      service.deleteAccount(uuidOf(7), false, { by: 'self', password: 'right' }),
    ).resolves.toBeUndefined();
  });

  it('lets an administrator delete a password account without its password', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: uuidOf(7), password: 'hash', deletedAt: null });

    await expect(service.deleteAccount(uuidOf(7), false, { by: 'admin' })).resolves.toBeUndefined();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('removes drafts and withheld games, keeping published games by default', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: uuidOf(1) }, { id: uuidOf(2) }]);

    await service.deleteAccount(uuidOf(7), false, { by: 'self' });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: uuidOf(7), OR: [{ publishedAt: null }, { hiddenAt: { not: null } }] },
      }),
    );
    expect(projectService.remove).toHaveBeenCalledTimes(2);
    expect(prisma.gameSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: uuidOf(1) } });
    expect(prisma.workSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: uuidOf(1) } });
  });

  it('removes published games too when asked', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: uuidOf(3) }]);

    await service.deleteAccount(uuidOf(7), true, { by: 'self' });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: uuidOf(7) } }),
    );
    expect(projectService.remove).toHaveBeenCalledWith(uuidOf(3));
  });

  it('purges tokens, friends, notifications, ends hosted sessions and anonymises', async () => {
    await service.deleteAccount(uuidOf(7), false, { by: 'self' });

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: uuidOf(7) } });
    expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userAId: uuidOf(7) }, { userBId: uuidOf(7) }] },
    });
    expect(prisma.friendRequest.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ fromId: uuidOf(7) }, { toId: uuidOf(7) }] },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: uuidOf(7) } });
    expect(prisma.feedbackPrompt.deleteMany).toHaveBeenCalledWith({ where: { userId: uuidOf(7) } });
    expect(prisma.collection.deleteMany).toHaveBeenCalledWith({ where: { ownerId: uuidOf(7) } });
    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith({
      where: { hostId: uuidOf(7), endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
    expect(prisma.workSession.deleteMany).toHaveBeenCalledWith({ where: { hostId: uuidOf(7) } });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: uuidOf(7) },
        data: expect.objectContaining({
          email: expect.stringMatching(
            new RegExp(`^deleted-${uuidOf(7)}-[0-9a-f]{16}@deleted\\.naucto\\.invalid$`),
          ),
          username: expect.stringMatching(new RegExp(`^deleted_${uuidOf(7)}_[0-9a-f]{16}$`)),
          nickname: 'Deleted user',
          password: null,
          friendCode: null,
          deletedAt: expect.any(Date),
          role: USER,
          collaborators: { set: [] },
        }),
      }),
    );
  });

  it('takes the account off its former friends and its collaborators off its work sessions', async () => {
    prisma.friendship.findMany.mockResolvedValue([
      { userAId: uuidOf(3), userBId: uuidOf(7) },
      { userAId: uuidOf(7), userBId: uuidOf(9) },
    ]);
    prisma.workSession.findMany.mockResolvedValue([
      { users: [{ id: uuidOf(7) }, { id: uuidOf(4) }] },
    ]);

    await service.deleteAccount(uuidOf(7), false, { by: 'self' });

    expect(eventEmitter.emit.mock.calls).toEqual([
      [FRIENDSHIP_CHANGED, new FriendshipChangedEvent(uuidOf(7), uuidOf(3))],
      [FRIENDSHIP_CHANGED, new FriendshipChangedEvent(uuidOf(7), uuidOf(9))],
      [ACTIVITY_CHANGED, new ActivityChangedEvent(uuidOf(7))],
      [ACTIVITY_CHANGED, new ActivityChangedEvent(uuidOf(4))],
    ]);
  });

  it('erases analytics in the transaction that marks the account deleted, before marking it', async () => {
    await service.deleteAccount(uuidOf(7), false, { by: 'self' });

    expect(analyticsErasure.eraseWithin).toHaveBeenCalledWith(prisma, uuidOf(7));
    expect(analyticsErasure.eraseWithin.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.user.update.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('deletes profile assets and tolerates S3 failures', async () => {
    s3Service.deleteFile.mockRejectedValueOnce(new Error('nope'));

    await expect(service.deleteAccount(uuidOf(7), false, { by: 'self' })).resolves.toBeUndefined();

    expect(s3Service.deleteFile).toHaveBeenCalledWith({ key: `users/${uuidOf(7)}/profile` });
    expect(s3Service.deleteFile).toHaveBeenCalledWith({ key: `users/${uuidOf(7)}/background` });
  });

  it('deletes report screenshots, then clears the keys of the files that went', async () => {
    prisma.report.findMany.mockResolvedValue([
      { id: uuidOf(4), screenshotKey: `reports/${uuidOf(4)}/screenshot.png` },
      { id: uuidOf(5), screenshotKey: `reports/${uuidOf(5)}/screenshot.webp` },
    ]);
    s3Service.deleteFile.mockImplementation(({ key }: { key: string }) =>
      key.includes(`/${uuidOf(4)}/`) ? Promise.reject(new Error('denied')) : Promise.resolve(),
    );

    await service.deleteAccount(uuidOf(7), false, { by: 'self' });

    expect(s3Service.deleteFile).toHaveBeenCalledWith({
      key: `reports/${uuidOf(4)}/screenshot.png`,
    });
    expect(prisma.report.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [uuidOf(5)] } },
      data: { screenshotKey: null, screenshotMime: null, screenshotBytes: null },
    });
  });

  it('has decided the fate of every relation the User model holds', () => {
    const userModel = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === Prisma.ModelName.User,
    );
    const relations = (userModel?.fields ?? [])
      .filter((field) => field.kind === 'object')
      .map((field) => field.name);

    expect(relations).not.toHaveLength(0);
    expect(Object.keys(USER_RELATION_FATES).sort()).toEqual([...relations].sort());
  });
});
