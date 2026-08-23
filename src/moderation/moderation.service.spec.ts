import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from "@nestjs/common";
import { ModerationService } from "./moderation.service";
import { AuditService } from "./audit";
import { PrismaService } from "@ourPrisma/prisma.service";

type AnyFn = jest.Mock;

function makePrismaMock(): Record<string, Record<string, AnyFn>> {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn()
    },
    project: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    comment: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    report: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn()
    },
    role: {
      findMany: jest.fn()
    },
    moderationAction: {
      create: jest.fn().mockResolvedValue({ id: 1 })
    }
  };
}

async function buildService(
  prismaMock: ReturnType<typeof makePrismaMock>,
  auditMock: { record: AnyFn } = {
    record: jest.fn().mockResolvedValue(undefined)
  }
): Promise<ModerationService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ModerationService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: AuditService, useValue: auditMock }
    ]
  }).compile();
  return module.get<ModerationService>(ModerationService);
}

describe("ModerationService", () => {
  describe("setUserStatus", () => {
    it("updates account status and writes audit row", async () => {
      const prisma = makePrismaMock();
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({
        id: 5,
        accountStatus: "ACTIVE",
      });
      prisma["user"]!["update"]!.mockResolvedValueOnce({
        id: 5,
        accountStatus: "SUSPENDED",
      });

      const service = await buildService(prisma, audit);
      await service.setUserStatus(5, 1, "SUSPENDED", "spam", 42);

      expect(prisma["user"]!["update"]).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          accountStatus: "SUSPENDED",
        }),
        select: expect.any(Object)
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 1,
          ref: { type: "USER", id: 5 },
          action: "SUSPEND_USER",
          reportId: 42
        })
      );
    });

    it("throws NotFoundException when user does not exist", async () => {
      const prisma = makePrismaMock();
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce(null);
      const service = await buildService(prisma);
      await expect(service.setUserStatus(999, 1, "BANNED")).rejects.toThrow(NotFoundException);
    });
  });

  describe("setReportStatus", () => {
    it("transitions OPEN to IN_REVIEW", async () => {
      const prisma = makePrismaMock();
      prisma["report"]!["findUnique"]!.mockResolvedValueOnce({
        id: 3,
        status: "OPEN",
        resolutionNote: null
      });
      prisma["report"]!["update"]!.mockResolvedValueOnce({ id: 3, status: "IN_REVIEW" });
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      const service = await buildService(prisma, audit);
      await service.setReportStatus(3, 1, "IN_REVIEW");
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "REVIEW_REPORT",
          ref: { type: "REPORT", id: 3 },
          reportId: 3
        })
      );
    });

    it("RESOLVED is terminal and cannot transition further", async () => {
      const prisma = makePrismaMock();
      prisma["report"]!["findUnique"]!.mockResolvedValueOnce({
        id: 3,
        status: "RESOLVED",
        resolutionNote: null
      });
      const service = await buildService(prisma);
      await expect(service.setReportStatus(3, 1, "OPEN")).rejects.toThrow(BadRequestException);
    });

    it("no-ops when status matches current", async () => {
      const prisma = makePrismaMock();
      prisma["report"]!["findUnique"]!.mockResolvedValueOnce({
        id: 3,
        status: "OPEN",
        resolutionNote: null
      });
      const service = await buildService(prisma);
      await service.setReportStatus(3, 1, "OPEN");
      expect(prisma["report"]!["update"]).not.toHaveBeenCalled();
      expect(prisma["moderationAction"]!["create"]).not.toHaveBeenCalled();
    });
  });

  describe("updateUserRoles", () => {
    it("refuses to revoke Admin from the last remaining Admin", async () => {
      const prisma = makePrismaMock();
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({
        id: 1,
        roles: [{ name: "Admin" }]
      });
      prisma["user"]!["count"]!.mockResolvedValueOnce(1);
      const service = await buildService(prisma);
      await expect(
        service.updateUserRoles(1, 2, [], ["Admin"], "test")
      ).rejects.toThrow(BadRequestException);
    });

    it("allows revoking Admin when other Admins remain", async () => {
      const prisma = makePrismaMock();
      const audit = { record: jest.fn().mockResolvedValue(undefined) };
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({
        id: 1,
        roles: [{ name: "Admin" }]
      });
      prisma["user"]!["count"]!.mockResolvedValueOnce(3);
      prisma["role"]!["findMany"]!.mockResolvedValueOnce([]);
      prisma["role"]!["findMany"]!.mockResolvedValueOnce([{ id: 99, name: "Admin" }]);
      prisma["user"]!["update"]!.mockResolvedValueOnce({ id: 1 });
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({ id: 1, roles: [] });
      const service = await buildService(prisma, audit);
      await service.updateUserRoles(1, 2, [], ["Admin"], "test");
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: "UPDATE_ROLES" })
      );
    });
  });

  describe("hardDeleteUser", () => {
    it("refuses to delete the sole remaining Admin", async () => {
      const prisma = makePrismaMock();
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({
        id: 1,
        roles: [{ name: "Admin" }]
      });
      prisma["user"]!["count"]!.mockResolvedValueOnce(1);
      const service = await buildService(prisma);
      await expect(service.hardDeleteUser(1, 2, "cleanup")).rejects.toThrow(BadRequestException);
      expect(prisma["user"]!["delete"]).not.toHaveBeenCalled();
    });
  });

  describe("createReport", () => {
    // Reporting your own content only adds noise: the author can delete their
    // comment, the owner can unpublish their project.
    it("refuses a report on your own comment", async () => {
      const prisma = makePrismaMock();
      prisma["comment"]!["findUnique"]!.mockResolvedValueOnce({
        id: 9,
        authorId: 1
      });
      const service = await buildService(prisma);

      await expect(
        service.createReport(1, {
          targetType: "COMMENT",
          targetId: 9,
          reason: "spam"
        })
      ).rejects.toThrow(BadRequestException);
      expect(prisma["report"]!["create"]).not.toHaveBeenCalled();
    });

    it("refuses a report on your own project", async () => {
      const prisma = makePrismaMock();
      prisma["project"]!["findUnique"]!.mockResolvedValueOnce({
        id: 4,
        userId: 1
      });
      const service = await buildService(prisma);

      await expect(
        service.createReport(1, {
          targetType: "PROJECT",
          targetId: 4,
          reason: "spam"
        })
      ).rejects.toThrow(BadRequestException);
    });

    it("refuses reporting yourself", async () => {
      const prisma = makePrismaMock();
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({ id: 1 });
      const service = await buildService(prisma);

      await expect(
        service.createReport(1, {
          targetType: "USER",
          targetId: 1,
          reason: "spam"
        })
      ).rejects.toThrow(BadRequestException);
    });

    it("accepts a report on someone else's comment", async () => {
      const prisma = makePrismaMock();
      prisma["comment"]!["findUnique"]!.mockResolvedValueOnce({
        id: 9,
        authorId: 2
      });
      prisma["report"]!["create"]!.mockResolvedValueOnce({ id: 1 });
      const service = await buildService(prisma);

      await service.createReport(1, {
        targetType: "COMMENT",
        targetId: 9,
        reason: "spam"
      });

      expect(prisma["report"]!["create"]).toHaveBeenCalled();
    });
  });

  describe("staff rank protection", () => {
    // Without this a moderator can ban every admin and lock the platform's own
    // staff out of the panel.
    const withRoles = (
      prisma: ReturnType<typeof makePrismaMock>,
      actorRoles: string[],
      targetRoles: string[]
    ): void => {
      prisma["user"]!["findUnique"]!
        .mockResolvedValueOnce({ id: 5, accountStatus: "ACTIVE" })
        .mockResolvedValueOnce({ roles: actorRoles.map((name) => ({ name })) })
        .mockResolvedValueOnce({ roles: targetRoles.map((name) => ({ name })) });
    };

    it("refuses a moderator banning another moderator", async () => {
      const prisma = makePrismaMock();
      withRoles(prisma, ["Moderator"], ["Moderator"]);
      const service = await buildService(prisma);

      await expect(
        service.setUserStatus(5, 1, "BANNED" as never)
      ).rejects.toThrow(ForbiddenException);
      expect(prisma["user"]!["update"]).not.toHaveBeenCalled();
    });

    it("refuses a moderator banning an admin", async () => {
      const prisma = makePrismaMock();
      withRoles(prisma, ["Moderator"], ["Admin"]);
      const service = await buildService(prisma);

      await expect(
        service.setUserStatus(5, 1, "BANNED" as never)
      ).rejects.toThrow(ForbiddenException);
    });

    it("refuses an admin banning another admin", async () => {
      const prisma = makePrismaMock();
      withRoles(prisma, ["Admin"], ["Admin"]);
      const service = await buildService(prisma);

      await expect(
        service.setUserStatus(5, 1, "BANNED" as never)
      ).rejects.toThrow(ForbiddenException);
    });

    it("lets an admin ban a moderator", async () => {
      const prisma = makePrismaMock();
      withRoles(prisma, ["Admin"], ["Moderator"]);
      prisma["user"]!["count"]!.mockResolvedValueOnce(2);
      prisma["user"]!["update"]!.mockResolvedValueOnce({
        id: 5,
        accountStatus: "BANNED"
      });
      const service = await buildService(prisma);

      await service.setUserStatus(5, 1, "BANNED" as never);

      expect(prisma["user"]!["update"]).toHaveBeenCalled();
    });

    it("lets a moderator moderate an ordinary user", async () => {
      const prisma = makePrismaMock();
      withRoles(prisma, ["Moderator"], []);
      prisma["user"]!["count"]!.mockResolvedValueOnce(2);
      prisma["user"]!["update"]!.mockResolvedValueOnce({
        id: 5,
        accountStatus: "SUSPENDED"
      });
      const service = await buildService(prisma);

      await service.setUserStatus(5, 1, "SUSPENDED" as never);

      expect(prisma["user"]!["update"]).toHaveBeenCalled();
    });

    it("refuses acting on your own account", async () => {
      const prisma = makePrismaMock();
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({
        id: 1,
        accountStatus: "ACTIVE"
      });
      const service = await buildService(prisma);

      await expect(
        service.setUserStatus(1, 1, "BANNED" as never)
      ).rejects.toThrow(BadRequestException);
    });

    it("refuses banning the last active admin", async () => {
      const prisma = makePrismaMock();
      withRoles(prisma, ["Admin"], ["Moderator"]);
      prisma["user"]!["count"]!.mockResolvedValueOnce(0);
      const service = await buildService(prisma);

      await expect(
        service.setUserStatus(5, 1, "BANNED" as never)
      ).rejects.toThrow(BadRequestException);
    });
  });
});
