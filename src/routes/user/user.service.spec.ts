import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { UserService } from "./user.service";
import { PrismaService } from "@ourPrisma/prisma.service";

describe("UserService", () => {
  let service: UserService;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn()
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
});
