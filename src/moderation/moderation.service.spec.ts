import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ModerationService } from "./moderation.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AnalyticsService } from "src/analytics/analytics.service";

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
  prismaMock: ReturnType<typeof makePrismaMock>
): Promise<ModerationService> {
  const analyticsMock = { record: jest.fn().mockResolvedValue(undefined) };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ModerationService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: AnalyticsService, useValue: analyticsMock }
    ]
  }).compile();
  return module.get<ModerationService>(ModerationService);
}

describe("ModerationService", () => {
  describe("setUserStatus", () => {
    it("updates account status and writes audit row", async () => {
      const prisma = makePrismaMock();
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({
        id: 5,
        accountStatus: "ACTIVE",
        moderationReason: null,
        moderatedAt: null,
        moderatedById: null
      });
      prisma["user"]!["update"]!.mockResolvedValueOnce({
        id: 5,
        accountStatus: "SUSPENDED",
        moderationReason: "spam",
        moderatedAt: new Date(),
        moderatedById: 1
      });

      const service = await buildService(prisma);
      await service.setUserStatus(5, 1, "SUSPENDED", "spam", 42);

      expect(prisma["user"]!["update"]).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          accountStatus: "SUSPENDED",
          moderationReason: "spam",
          moderatedById: 1
        }),
        select: expect.any(Object)
      });
      expect(prisma["moderationAction"]!["create"]).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: 1,
          targetType: "USER",
          targetId: 5,
          action: "SUSPEND_USER",
          reportId: 42
        })
      });
    });

    it("throws NotFoundException when user does not exist", async () => {
      const prisma = makePrismaMock();
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce(null);
      const service = await buildService(prisma);
      await expect(service.setUserStatus(999, 1, "BANNED")).rejects.toThrow(NotFoundException);
    });
  });

  describe("hideProject / restoreProject", () => {
    it("hideProject archives and audits as HIDE_PROJECT", async () => {
      const prisma = makePrismaMock();
      prisma["project"]!["findUnique"]!.mockResolvedValueOnce({ id: 10, hidden: false });
      prisma["project"]!["update"]!.mockResolvedValueOnce({ id: 10, hidden: true });
      const service = await buildService(prisma);
      await service.hideProject(10, 1, "tos", 5);
      expect(prisma["project"]!["update"]).toHaveBeenCalledWith({
        where: { id: 10 },
        data: expect.objectContaining({
          hidden: true,
          status: "ARCHIVED"
        })
      });
      expect(prisma["moderationAction"]!["create"]).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "HIDE_PROJECT",
          targetType: "PROJECT",
          targetId: 10,
          reportId: 5
        })
      });
    });

    it("restoreProject clears hidden flags and audits as RESTORE_PROJECT", async () => {
      const prisma = makePrismaMock();
      prisma["project"]!["findUnique"]!.mockResolvedValueOnce({ id: 10, hidden: true });
      prisma["project"]!["update"]!.mockResolvedValueOnce({ id: 10, hidden: false });
      const service = await buildService(prisma);
      await service.restoreProject(10, 1);
      expect(prisma["project"]!["update"]).toHaveBeenCalledWith({
        where: { id: 10 },
        data: expect.objectContaining({
          hidden: false,
          hiddenReason: null,
          hiddenAt: null,
          hiddenById: null
        })
      });
      expect(prisma["moderationAction"]!["create"]).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: "RESTORE_PROJECT" })
      });
    });
  });

  describe("hideComment / restoreComment / editComment", () => {
    it("hideComment audits as HIDE_COMMENT", async () => {
      const prisma = makePrismaMock();
      prisma["comment"]!["findUnique"]!.mockResolvedValueOnce({ id: 7 });
      prisma["comment"]!["update"]!.mockResolvedValueOnce({ id: 7, hidden: true });
      const service = await buildService(prisma);
      await service.hideComment(7, 1, "abuse");
      expect(prisma["moderationAction"]!["create"]).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "HIDE_COMMENT",
          targetType: "COMMENT",
          targetId: 7
        })
      });
    });

    it("editComment updates content and audits as EDIT_COMMENT", async () => {
      const prisma = makePrismaMock();
      prisma["comment"]!["findUnique"]!.mockResolvedValueOnce({ id: 7, content: "old" });
      prisma["comment"]!["update"]!.mockResolvedValueOnce({ id: 7, content: "new" });
      const service = await buildService(prisma);
      await service.editComment(7, 1, "new");
      expect(prisma["comment"]!["update"]).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { content: "new" }
      });
      expect(prisma["moderationAction"]!["create"]).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: "EDIT_COMMENT" })
      });
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
      const service = await buildService(prisma);
      await service.setReportStatus(3, 1, "IN_REVIEW");
      expect(prisma["moderationAction"]!["create"]).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "REVIEW_REPORT",
          targetType: "REPORT",
          targetId: 3,
          reportId: 3
        })
      });
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
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({
        id: 1,
        roles: [{ name: "Admin" }]
      });
      prisma["user"]!["count"]!.mockResolvedValueOnce(3);
      prisma["role"]!["findMany"]!.mockResolvedValueOnce([]);
      prisma["role"]!["findMany"]!.mockResolvedValueOnce([{ id: 99, name: "Admin" }]);
      prisma["user"]!["update"]!.mockResolvedValueOnce({ id: 1 });
      prisma["user"]!["findUnique"]!.mockResolvedValueOnce({ id: 1, roles: [] });
      const service = await buildService(prisma);
      await service.updateUserRoles(1, 2, [], ["Admin"], "test");
      expect(prisma["moderationAction"]!["create"]).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: "UPDATE_ROLES" })
      });
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
