import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "@ourPrisma/prisma.service";
import { UserService } from "@user/user.service";
import { ModerationService } from "src/moderation/moderation.service";
import { AdminUserService } from "./admin-user.service";
import { AdminUserFilterDto } from "./dto/users/admin-user-filter.dto";

jest.mock("bcryptjs", () => ({ hash: jest.fn() }));

const USER = {
  id: 5,
  email: "player@naucto.com",
  username: "player",
  nickname: null,
  accountStatus: "ACTIVE",
  createdAt: new Date("2026-01-01"),
  moderationReason: null,
  moderatedAt: null,
  moderatedById: null,
  roles: [{ name: "User" }]
};

type PrismaMock = {
  user: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
  project: { count: jest.Mock };
  comment: { count: jest.Mock };
  report: { count: jest.Mock };
  moderationAction: { count: jest.Mock };
  role: { upsert: jest.Mock };
};

function filter(overrides: Partial<AdminUserFilterDto> = {}): AdminUserFilterDto {
  return { ...overrides } as AdminUserFilterDto;
}

describe("AdminUserService", () => {
  let service: AdminUserService;
  let prisma: PrismaMock;
  let moderation: Record<string, jest.Mock>;
  let userService: Record<string, jest.Mock>;

  beforeEach(async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue("hashed");

    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([USER]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(USER)
      },
      project: { count: jest.fn().mockResolvedValue(2) },
      comment: { count: jest.fn().mockResolvedValue(3) },
      report: { count: jest.fn().mockResolvedValue(0) },
      moderationAction: { count: jest.fn().mockResolvedValue(0) },
      role: { upsert: jest.fn().mockResolvedValue({ name: "Moderator" }) }
    };
    moderation = {
      setUserStatus: jest.fn().mockResolvedValue(undefined),
      updateUserRoles: jest.fn().mockResolvedValue(undefined),
      editUser: jest.fn().mockResolvedValue(undefined),
      resetUserPassword: jest.fn().mockResolvedValue(undefined),
      hardDeleteUser: jest.fn().mockResolvedValue(undefined),
      recordStaffCreation: jest.fn().mockResolvedValue(undefined)
    };
    userService = { create: jest.fn().mockResolvedValue({ id: 5 }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserService,
        { provide: PrismaService, useValue: prisma },
        { provide: UserService, useValue: userService },
        { provide: ModerationService, useValue: moderation }
      ]
    }).compile();

    service = module.get<AdminUserService>(AdminUserService);
  });

  describe("list", () => {
    it("paginates with the shared defaults", async () => {
      const result = await service.list(filter());

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 25 })
      );
      expect(result.meta.totalPages).toBe(1);
    });

    it("filters by role through the relation", async () => {
      await service.list(filter({ role: "Moderator" }));

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roles: { some: { name: "Moderator" } } }
        })
      );
    });

    it("rejects a sort field outside the allowlist", async () => {
      // `password` is a real column; without the allowlist it would order by it.
      await expect(service.list(filter({ sortBy: "password" }))).rejects.toThrow(
        BadRequestException
      );
    });

    it("never exposes the password hash", async () => {
      const result = await service.list(filter());

      expect(result.data[0]).not.toHaveProperty("password");
    });
  });

  describe("findOne", () => {
    it("throws NotFoundException for an unknown user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne(404)).rejects.toThrow(NotFoundException);
    });

    it("attaches the activity counts the detail page shows", async () => {
      await expect(service.findOne(5)).resolves.toMatchObject({
        projectsCreatedCount: 2,
        commentsCount: 3,
        reportsFiledCount: 0,
        moderationActionsTakenCount: 0
      });
    });
  });

  describe("moderation actions", () => {
    it("suspend and ban both route through setUserStatus", async () => {
      await service.setStatus(5, 1, "SUSPENDED", "spam", 9);

      expect(moderation["setUserStatus"]).toHaveBeenCalledWith(
        5,
        1,
        "SUSPENDED",
        "spam",
        9
      );
    });

    it("grantRole seeds the role before assigning it", async () => {
      await service.grantRole(5, 1, "Moderator");

      expect(prisma.role.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: "Moderator" } })
      );
      expect(moderation["updateUserRoles"]).toHaveBeenCalledWith(
        5,
        1,
        ["Moderator"],
        [],
        "Granted Moderator access"
      );
    });

    it("grantRole promotes an existing moderator to Admin", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...USER,
        roles: [{ name: "Moderator" }]
      });

      await service.grantRole(5, 1, "Admin", "promoted");

      expect(moderation["updateUserRoles"]).toHaveBeenCalledWith(
        5,
        1,
        ["Admin"],
        [],
        "promoted"
      );
    });

    it("grantRole refuses a role the user already holds", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...USER,
        roles: [{ name: "Moderator" }]
      });

      await expect(service.grantRole(5, 1, "Moderator")).rejects.toThrow(
        BadRequestException
      );
      expect(moderation["updateUserRoles"]).not.toHaveBeenCalled();
    });

    it("revokeRole disconnects only that role", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...USER,
        roles: [{ name: "Moderator" }]
      });

      await service.revokeRole(5, 1, "Moderator");

      expect(moderation["updateUserRoles"]).toHaveBeenCalledWith(
        5,
        1,
        [],
        ["Moderator"],
        "Revoked Moderator access"
      );
    });

    it("revokeRole refuses a role the user does not hold", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...USER,
        roles: [{ name: "Moderator" }]
      });

      await expect(service.revokeRole(5, 1, "Admin")).rejects.toThrow(
        BadRequestException
      );
    });

    it("refuses revoking your own Admin role", async () => {
      // The last-admin guard does not catch this while other admins exist, and
      // it would lock the actor out of every admin-only page.
      await expect(service.revokeRole(1, 1, "Admin")).rejects.toThrow(
        BadRequestException
      );
      expect(moderation["updateUserRoles"]).not.toHaveBeenCalled();
    });

    it("allows revoking someone else's Admin role", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...USER,
        roles: [{ name: "Admin" }]
      });

      await service.revokeRole(5, 1, "Admin", "stepping down");

      expect(moderation["updateUserRoles"]).toHaveBeenCalledWith(
        5,
        1,
        [],
        ["Admin"],
        "stepping down"
      );
    });

    it("resetPassword hands over a hash, never the plaintext", async () => {
      await service.resetPassword(5, 1, "new-secret");

      expect(bcrypt.hash).toHaveBeenCalledWith("new-secret", 10);
      expect(moderation["resetUserPassword"]).toHaveBeenCalledWith(
        5,
        1,
        "hashed",
        null
      );
    });

    it("refuses to delete the acting admin's own account", async () => {
      await expect(service.hardDelete(1, 1)).rejects.toThrow(
        BadRequestException
      );
      expect(moderation["hardDeleteUser"]).not.toHaveBeenCalled();
    });

    it("deletes another account through the audited path", async () => {
      await expect(service.hardDelete(5, 1, "gdpr")).resolves.toEqual({
        success: true
      });
      expect(moderation["hardDeleteUser"]).toHaveBeenCalledWith(5, 1, "gdpr");
    });
  });

  describe("update", () => {
    it("only touches roles that actually changed", async () => {
      await service.update(5, { roles: ["User", "Moderator"] }, 1);

      expect(moderation["updateUserRoles"]).toHaveBeenCalledWith(
        5,
        1,
        ["Moderator"],
        [],
        undefined
      );
    });

    it("skips the role update when the set is unchanged", async () => {
      await service.update(5, { roles: ["User"] }, 1);

      expect(moderation["updateUserRoles"]).not.toHaveBeenCalled();
    });

    it("skips the profile edit when no profile field was sent", async () => {
      await service.update(5, { roles: ["User"] }, 1);

      expect(moderation["editUser"]).not.toHaveBeenCalled();
    });
  });
});
