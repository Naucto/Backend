import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
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
    workSession: { deleteMany: jest.fn() },
    refreshToken: { deleteMany: jest.fn() },
    friendship: { deleteMany: jest.fn() },
    friendRequest: { deleteMany: jest.fn() },
    notification: { deleteMany: jest.fn() },
  };
  const projectService = { remove: jest.fn() };
  const s3Service = { deleteFile: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    // Array-style transaction: the operations are already "queued" mocks, so
    // resolving is enough.
    prisma.$transaction.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ id: 7, password: null, deletedAt: null });
    prisma.project.findMany.mockResolvedValue([]);
    s3Service.deleteFile.mockResolvedValue(undefined);

    const module = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectService, useValue: projectService },
        ProfileAssetService,
        { provide: S3Service, useValue: s3Service },
        { provide: EdgeService, useValue: {} },
      ],
    }).compile();

    service = module.get(AccountDeletionService);
  });

  it('404s for an unknown or already deleted user', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteAccount(7, false)).rejects.toBeInstanceOf(NotFoundException);

    prisma.user.findUnique.mockResolvedValueOnce({ id: 7, password: null, deletedAt: new Date() });
    await expect(service.deleteAccount(7, false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('verifies the password when one is provided on a password account', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 7, password: 'hash', deletedAt: null });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(service.deleteAccount(7, false, 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('removes unpublished projects only, keeping published games by default', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.deleteAccount(7, false);

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, publishedAt: null },
      }),
    );
    expect(projectService.remove).toHaveBeenCalledTimes(2);
    expect(prisma.gameSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: 1 } });
    expect(prisma.workSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: 1 } });
  });

  it('removes published games too when asked', async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 3 }]);

    await service.deleteAccount(7, true);

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7 } }),
    );
    expect(projectService.remove).toHaveBeenCalledWith(3);
  });

  it('purges tokens, friends, notifications, ends hosted sessions and anonymises', async () => {
    await service.deleteAccount(7, false);

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userAId: 7 }, { userBId: 7 }] },
    });
    expect(prisma.friendRequest.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ fromId: 7 }, { toId: 7 }] },
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith({
      where: { hostId: 7, endedAt: null },
      data: { endedAt: expect.any(Date) },
    });
    expect(prisma.workSession.deleteMany).toHaveBeenCalledWith({ where: { hostId: 7 } });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({
          email: expect.stringMatching(/^deleted-7-[0-9a-f]{16}@deleted\.naucto\.invalid$/),
          username: expect.stringMatching(/^deleted_7_[0-9a-f]{16}$/),
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

  it('deletes profile assets and tolerates S3 failures', async () => {
    s3Service.deleteFile.mockRejectedValueOnce(new Error('nope'));

    await expect(service.deleteAccount(7, false)).resolves.toBeUndefined();

    expect(s3Service.deleteFile).toHaveBeenCalledWith({ key: 'users/7/profile' });
    expect(s3Service.deleteFile).toHaveBeenCalledWith({ key: 'users/7/background' });
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
