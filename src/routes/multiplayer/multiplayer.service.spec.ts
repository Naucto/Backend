import { ProjectService, ProjectEx } from "@project/project.service";
import { UserService } from "@user/user.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { S3Service } from "@s3/s3.service";
import { WebRTCService } from "@webrtc/webrtc.service";
import { MultiplayerService } from "./multiplayer.service";
import { Test } from "@nestjs/testing";
import { User, GameSession, GameSessionVisibility } from "@prisma/client";

jest.mock("@webrtc/server/webrtc.server", () => {
  return {
    WebRTCServer: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      emit: jest.fn()
    }))
  };
});

describe("MultiplayerService", () => {
  let service: MultiplayerService;

  beforeEach(async () => {
    const webrtcServiceMock = {
      buildOffer: jest.fn().mockReturnValue({})
    };

    const prismaServiceMock = {
      project: {},
      user: {},
      workSession: {},
      gameSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn()
      },
      $connect: jest.fn(),
      $disconnect: jest.fn()
    };

    const userServiceMock = {
      findOne: jest.fn(),
      attachGameSession: jest.fn(),
      detachGameSession: jest.fn()
    };

    const module = await Test.createTestingModule({
      providers: [
        MultiplayerService,
        ProjectService,
        { provide: UserService, useValue: userServiceMock },
        { provide: WebRTCService, useValue: webrtcServiceMock },
        { provide: PrismaService, useValue: prismaServiceMock },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === "S3_MAX_AUTO_HISTORY_VERSION") return "5";
              if (key === "S3_AUTO_HISTORY_DELAY") return "10";
              if (key === "S3_MAX_CHECKPOINTS") return "5";
              return undefined;
            })
          }
        },
        {
          provide: S3Service,
          useValue: {}
        }
      ]
    }).compile();

    service = module.get<MultiplayerService>(MultiplayerService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("lookupHosts", () => {
    // TODO: Implement tests for lookupHosts once friends logic is implemented in the service
  });

  describe("openHost", () => {
    it("should throw if user does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce(null as any);
      await expect(service.openHost(1, 1, "PUBLIC" as import("@prisma/client").GameSessionVisibility)).rejects.toThrow("User with ID 1 not found");
    });
    it("should throw if project does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 1,
        email: "user@example.com",
        username: "user",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        hostingGameSessions: []
      } as User & { hostingGameSessions: GameSession[] });
      jest.spyOn(service["_projectService"], "findOne").mockResolvedValueOnce(null as any);
      await expect(service.openHost(1, 1, "PUBLIC" as GameSessionVisibility)).rejects.toThrow("Project with ID 1 not found");
    });
    it("should throw if user already hosting", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 1,
        email: "user@example.com",
        username: "user",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        hostingGameSessions: [{
          id: 1,
          hostId: 1,
          projectId: 1,
          startedAt: new Date(),
          endedAt: null,
          visibility: "PUBLIC" as GameSessionVisibility,
          sessionId: "uuid"
        }]
      } as User & { hostingGameSessions: GameSession[] });
      jest.spyOn(service["_projectService"], "findOne").mockResolvedValueOnce({
        id: 1,
        name: "Project",
        createdAt: new Date(),
        updatedAt: new Date(),
        collaborators: [],
        creator: { id: 1, username: "creator", email: "creator@example.com" }
      } as unknown as ProjectEx);
      await expect(service.openHost(1, 1, "PUBLIC" as GameSessionVisibility)).rejects.toThrow("User already hosting a game session for this project");
    });
    it("should create a new game session", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 1,
        email: "user@example.com",
        username: "user",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        hostingGameSessions: []
      } as User & { hostingGameSessions: GameSession[] });
      jest.spyOn(service["_projectService"], "findOne").mockResolvedValueOnce({
        id: 1,
        name: "Project",
        createdAt: new Date(),
        updatedAt: new Date(),
        collaborators: [],
        creator: { id: 1, username: "creator", email: "creator@example.com" }
      } as unknown as ProjectEx);
      jest.spyOn(service["_prismaService"].gameSession, "create").mockResolvedValueOnce({
        id: 1,
        hostId: 1,
        projectId: 1,
        startedAt: new Date(),
        endedAt: null,
        visibility: "PUBLIC" as GameSessionVisibility,
        sessionId: "uuid"
      } as GameSession);
      jest.spyOn(service["_userService"], "attachGameSession").mockResolvedValueOnce(Promise.resolve());
      const result = await service.openHost(1, 1, "PUBLIC" as GameSessionVisibility);
      expect(result).toHaveProperty("sessionUuid", "uuid");
    });
  });

  describe("closeHost", () => {
    it("should throw if user does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce(null as never);
      await expect(service.closeHost(1, 1)).rejects.toThrow();
    });
    it("should throw if project does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 1,
        email: "user@example.com",
        username: "user",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        hostingGameSessions: []
      } as User & { hostingGameSessions: GameSession[] });
      jest.spyOn(service["_projectService"], "findOne").mockResolvedValueOnce(null as never);
      await expect(service.closeHost(1, 1)).rejects.toThrow();
    });
    it("should throw if not hosting", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 1,
        email: "user@example.com",
        username: "user",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        hostingGameSessions: []
      } as User & { hostingGameSessions: GameSession[] });
      jest.spyOn(service["_projectService"], "findOne").mockResolvedValueOnce({
        id: 1,
        name: "Project",
        createdAt: new Date(),
        updatedAt: new Date(),
        collaborators: [],
        creator: { id: 1, username: "creator", email: "creator@example.com" }
      } as unknown as ProjectEx);
      await expect(service.closeHost(1, 1)).rejects.toThrow();
    });
    it("should close the host session", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 1,
        email: "user@example.com",
        username: "user",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        hostingGameSessions: [{
          id: 1,
          hostId: 1,
          projectId: 1,
          startedAt: new Date(),
          endedAt: null,
          visibility: "PUBLIC" as GameSessionVisibility,
          sessionId: "uuid"
        }]
      } as User & { hostingGameSessions: GameSession[] });
      jest.spyOn(service["_projectService"], "findOne").mockResolvedValueOnce({
        id: 1,
        name: "Project",
        createdAt: new Date(),
        updatedAt: new Date(),
        collaborators: [],
        creator: { id: 1, username: "creator", email: "creator@example.com" }
      } as unknown as ProjectEx);
      jest.spyOn(service["_prismaService"].gameSession, "findUnique").mockResolvedValueOnce({
        id: 1,
        hostId: 1,
        projectId: 1,
        startedAt: new Date(),
        endedAt: null,
        visibility: "PUBLIC" as GameSessionVisibility,
        sessionId: "uuid",
        otherUsers: []
      } as import("@prisma/client").GameSession);
      jest.spyOn(service["_userService"], "attachGameSession").mockResolvedValueOnce(Promise.resolve());
      const result = await service.closeHost(1, 1);
      expect(result).toBeUndefined();
    });
    it("should throw if user does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce(null as never);
      await expect(service.joinHost(1, "uuid")).rejects.toThrow();
    });
    it("should throw if host session does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 2,
        email: "user2@example.com",
        username: "user2",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        joinedGameSessions: []
      } as User & { joinedGameSessions: GameSession[] });
      jest.spyOn(service["_prismaService"].gameSession, "findUnique").mockResolvedValueOnce(null);
      await expect(service.joinHost(1, "uuid")).rejects.toThrow();
    });
  });

  describe("joinHost", () => {
    it("should throw if user does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce(null as never);
      await expect(service.joinHost(1, "uuid")).rejects.toThrow();
    });
    it("should throw if host session does not exist", async () => {
      jest.spyOn(service["_userService"], "findOne").mockResolvedValueOnce({
        id: 2,
        email: "user2@example.com",
        username: "user2",
        nickname: null,
        password: "hashed",
        createdAt: new Date(),
        joinedGameSessions: []
      } as User & { joinedGameSessions: GameSession[] });
      jest.spyOn(service["_prismaService"].gameSession, "findUnique").mockResolvedValueOnce(null);
      await expect(service.leaveHost(1, "uuid")).rejects.toThrow();
    });
  });
});

