import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UserService } from "./user.service";
import { PrismaService } from "@ourPrisma/prisma.service";

function uniqueViolation(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target }
  });
}

describe("UserService", () => {
  let service: UserService;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn()
      }
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn(),
            ...prisma
          }
        }
      ]
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("findPublicProfile", () => {
    it("should return a public user profile", async () => {
      const publicProfile = {
        id: 1,
        username: "alice",
        nickname: "Ali",
        description: "Hello"
      };

      prisma.user.findUnique.mockResolvedValue(publicProfile);

      await expect(service.findPublicProfile(1)).resolves.toEqual(publicProfile);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          id: true,
          username: true,
          nickname: true,
          description: true
        }
      });
    });

    it("should throw a NotFoundException when user does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findPublicProfile(42)).rejects.toThrow(
        new NotFoundException("User with ID 42 not found")
      );
    });
  });

  describe("findPublicProfileByUsername", () => {
    it("should return a public user profile by username", async () => {
      const publicProfile = {
        id: 1,
        username: "Madeline",
        nickname: "Maddy",
        description: "Hello"
      };

      prisma.user.findUnique.mockResolvedValue(publicProfile);

      await expect(service.findPublicProfileByUsername("Madeline")).resolves.toEqual(publicProfile);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: "Madeline" },
        select: {
          id: true,
          username: true,
          nickname: true,
          description: true
        }
      });
    });

    it("should throw a NotFoundException when username does not exist", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findPublicProfileByUsername("unknown")).rejects.toThrow(
        new NotFoundException("User with username unknown not found")
      );
    });
  });

  describe("getMe", () => {
    it("returns the stored friend code and join policy", async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "FRIENDS"
      });

      await expect(service.getMe(1)).resolves.toEqual({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "FRIENDS"
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("lazily mints a friend code when the user has none", async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: null,
        sessionJoinPolicy: "ANYONE"
      });
      prisma.user.update.mockResolvedValue({ id: 1 });

      const me = await service.getMe(1);

      expect(me.friendCode).toHaveLength(8);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { friendCode: me.friendCode }
        })
      );
    });

    it("retries on a friend code collision", async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: null,
        sessionJoinPolicy: "ANYONE"
      });
      prisma.user.update
        .mockRejectedValueOnce(uniqueViolation(["friendCode"]))
        .mockResolvedValueOnce({ id: 1 });

      const me = await service.getMe(1);

      expect(me.friendCode).toHaveLength(8);
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
    });

    it("gives up after repeated collisions", async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: null,
        sessionJoinPolicy: "ANYONE"
      });
      prisma.user.update.mockRejectedValue(uniqueViolation(["friendCode"]));

      await expect(service.getMe(1)).rejects.toBeInstanceOf(ConflictException);
    });

    it("rethrows unrelated unique violations", async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: null,
        sessionJoinPolicy: "ANYONE"
      });
      prisma.user.update.mockRejectedValue(uniqueViolation(["email"]));

      await expect(service.getMe(1)).rejects.toBeInstanceOf(
        Prisma.PrismaClientKnownRequestError
      );
    });

    it("throws NotFound for an unknown user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe(42)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("updateMe", () => {
    it("persists the join policy and returns the settings", async () => {
      prisma.user.update.mockResolvedValue({ id: 1 });
      prisma.user.findUnique.mockResolvedValue({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "CODE_ONLY"
      });

      await expect(
        service.updateMe(1, { sessionJoinPolicy: "CODE_ONLY" })
      ).resolves.toEqual({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "CODE_ONLY"
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { sessionJoinPolicy: "CODE_ONLY" } })
      );
    });

    it("does not write when nothing changed", async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: "7K3QW9ZB",
        sessionJoinPolicy: "ANYONE"
      });

      await service.updateMe(1, {});

      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe("regenerateFriendCode", () => {
    it("replaces the code even when one already exists", async () => {
      prisma.user.update.mockResolvedValue({ id: 1 });
      prisma.user.findUnique.mockResolvedValue({
        friendCode: "NEWCODE1",
        sessionJoinPolicy: "ANYONE"
      });

      await expect(service.regenerateFriendCode(1)).resolves.toEqual({
        friendCode: "NEWCODE1",
        sessionJoinPolicy: "ANYONE"
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { friendCode: expect.any(String) }
        })
      );
    });
  });

  describe("findIdByFriendCode", () => {
    it("normalizes the code and resolves a live user", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7, deletedAt: null });

      await expect(service.findIdByFriendCode("7k3q-w9zb")).resolves.toBe(7);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { friendCode: "7K3QW9ZB" } })
      );
    });

    it("returns null for malformed codes without querying", async () => {
      await expect(service.findIdByFriendCode("nope")).resolves.toBeNull();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("returns null for a deleted user", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7, deletedAt: new Date() });

      await expect(service.findIdByFriendCode("7K3QW9ZB")).resolves.toBeNull();
    });
  });
});
