import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
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
});
