import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ProjectService } from "@project/project.service";
import { S3Service } from "@s3/s3.service";
import { AccountDeletionService } from "./account-deletion.service";

jest.mock("bcryptjs", () => ({ compare: jest.fn() }));

describe("AccountDeletionService", () => {
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
    notification: { deleteMany: jest.fn() }
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
        { provide: S3Service, useValue: s3Service }
      ]
    }).compile();

    service = module.get(AccountDeletionService);
  });

  it("404s for an unknown or already deleted user", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    await expect(service.deleteAccount(7, {})).rejects.toBeInstanceOf(NotFoundException);

    prisma.user.findUnique.mockResolvedValueOnce({ id: 7, password: null, deletedAt: new Date() });
    await expect(service.deleteAccount(7, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it("verifies the password when one is provided on a password account", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 7, password: "hash", deletedAt: null });
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    await expect(
      service.deleteAccount(7, { password: "wrong" })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("removes unpublished projects only, keeping published games by default", async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.deleteAccount(7, {});

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 7, NOT: { status: "COMPLETED" } }
      })
    );
    expect(projectService.remove).toHaveBeenCalledTimes(2);
    expect(prisma.gameSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: 1 } });
    expect(prisma.workSession.deleteMany).toHaveBeenCalledWith({ where: { projectId: 1 } });
  });

  it("removes published games too when asked", async () => {
    prisma.project.findMany.mockResolvedValue([{ id: 3 }]);

    await service.deleteAccount(7, { removePublishedGames: true });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7 } })
    );
    expect(projectService.remove).toHaveBeenCalledWith(3);
  });

  it("purges tokens, friends, notifications, ends hosted sessions and anonymises", async () => {
    await service.deleteAccount(7, {});

    expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ userAId: 7 }, { userBId: 7 }] }
    });
    expect(prisma.friendRequest.deleteMany).toHaveBeenCalledWith({
      where: { OR: [{ fromId: 7 }, { toId: 7 }] }
    });
    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(prisma.gameSession.updateMany).toHaveBeenCalledWith({
      where: { hostId: 7, endedAt: null },
      data: { endedAt: expect.any(Date) }
    });
    expect(prisma.workSession.deleteMany).toHaveBeenCalledWith({ where: { hostId: 7 } });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({
          email: "deleted-7@deleted.naucto.invalid",
          username: "deleted_7",
          nickname: "Deleted user",
          password: null,
          friendCode: null,
          deletedAt: expect.any(Date),
          roles: { set: [] },
          collaborators: { set: [] }
        })
      })
    );
  });

  it("deletes profile assets and tolerates S3 failures", async () => {
    s3Service.deleteFile.mockRejectedValueOnce(new Error("nope"));

    await expect(service.deleteAccount(7, {})).resolves.toBeUndefined();

    expect(s3Service.deleteFile).toHaveBeenCalledWith({ key: "users/7/profile" });
    expect(s3Service.deleteFile).toHaveBeenCalledWith({ key: "users/7/background" });
  });
});
