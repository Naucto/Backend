import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { GameSession, GameSessionVisibility, User } from "@prisma/client";

import { ProjectService } from "@project/project.service";
import { ProjectNotFoundError } from "@project/project.error";
import { PrismaService } from "@ourPrisma/prisma.service";
import { WebRTCService } from "@webrtc/webrtc.service";

import { MultiplayerService } from "./multiplayer.service";
import { SyncedGameTableWebRTCServer } from "@webrtc/server/webrtc.server.synced-game-table";
import {
  MultiplayerForbiddenError,
  MultiplayerHostOpenedError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError
} from "./multiplayer.error";

// Avoid spinning up a real WebRTC/HTTP server during the service constructor.
jest.mock("@webrtc/server/webrtc.server.synced-game-table");

const SyncedGameTableServerMock =
  SyncedGameTableWebRTCServer as unknown as jest.Mock;

type GameSessionEx = GameSession & { otherUsers: User[] };

function makeSession(overrides: Partial<GameSessionEx> = {}): GameSessionEx {
  return {
    id: 1,
    hostId: 1,
    projectId: 1,
    startedAt: new Date(),
    endedAt: null,
    title: "My session",
    maxPlayers: 4,
    visibility: GameSessionVisibility.PUBLIC,
    joinCode: null,
    sessionId: "session-uuid",
    otherUsers: [],
    ...overrides
  };
}

describe("MultiplayerService", () => {
  let service: MultiplayerService;

  const gameSession = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn()
  };
  // Runs the interactive transaction callback against the same gameSession mock.
  const $transaction = jest.fn();

  const projectService = { findOne: jest.fn() };
  const webrtcService = { buildOffer: jest.fn() };
  const jwtService = { sign: jest.fn(), verify: jest.fn() };

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) also drains queued *Once values, so a
    // mock left unconsumed by one test can't leak into the next.
    jest.resetAllMocks();
    SyncedGameTableServerMock.mockImplementation(() => ({ closeRoom: jest.fn() }));
    webrtcService.buildOffer.mockReturnValue({});
    jwtService.sign.mockReturnValue("signed.ticket");
    $transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({ gameSession }));

    const module = await Test.createTestingModule({
      providers: [
        MultiplayerService,
        { provide: ProjectService, useValue: projectService },
        { provide: WebRTCService, useValue: webrtcService },
        { provide: PrismaService, useValue: { gameSession, $transaction } },
        { provide: JwtService, useValue: jwtService }
      ]
    }).compile();

    service = module.get<MultiplayerService>(MultiplayerService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("create", () => {
    it("throws if the project does not exist", async () => {
      projectService.findOne.mockResolvedValueOnce(null);

      await expect(
        service.create(1, {
          projectId: 99,
          title: "x",
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC
        })
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
    });

    it("throws if the user already hosts a session for the project", async () => {
      projectService.findOne.mockResolvedValueOnce({ id: 1 });
      gameSession.findFirst.mockResolvedValueOnce(makeSession());

      await expect(
        service.create(1, {
          projectId: 1,
          title: "x",
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC
        })
      ).rejects.toBeInstanceOf(MultiplayerHostOpenedError);
    });

    it("creates a session and returns a connection ticket", async () => {
      projectService.findOne.mockResolvedValueOnce({ id: 1 });
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockResolvedValueOnce(makeSession());

      const result = await service.create(1, {
        projectId: 1,
        title: "My session",
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC
      });

      expect(result.sessionUuid).toBe("session-uuid");
      expect(result.connectionTicket).toBe("signed.ticket");
      expect(jwtService.sign).toHaveBeenCalled();
    });

    it("generates a join code for INVITE_CODE sessions", async () => {
      projectService.findOne.mockResolvedValueOnce({ id: 1 });
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockImplementationOnce(({ data }: { data: { joinCode: string } }) =>
        Promise.resolve(makeSession({
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: data.joinCode
        }))
      );

      const result = await service.create(1, {
        projectId: 1,
        title: "Invite",
        maxPlayers: 4,
        visibility: GameSessionVisibility.INVITE_CODE
      });

      expect(result.joinCode).toBeDefined();
      expect(result.joinCode).toHaveLength(8);
    });
  });

  describe("join", () => {
    it("rejects an invalid join code on INVITE_CODE sessions", async () => {
      gameSession.findUnique.mockResolvedValueOnce(makeSession({
        visibility: GameSessionVisibility.INVITE_CODE,
        joinCode: "RIGHTCOD"
      }));

      await expect(service.join("session-uuid", 2, "WRONG")).rejects.toBeInstanceOf(
        MultiplayerInvalidJoinCodeError
      );
    });

    it("rejects when the session is full", async () => {
      // full check now runs inside the transaction, which re-reads via findUnique
      gameSession.findUnique.mockResolvedValue(makeSession({
        maxPlayers: 2,
        otherUsers: [{ id: 5 } as User]
      }));

      await expect(service.join("session-uuid", 2)).rejects.toBeInstanceOf(
        MultiplayerSessionFullError
      );
    });

    it("rejects a user that already joined", async () => {
      gameSession.findUnique.mockResolvedValueOnce(makeSession({
        otherUsers: [{ id: 2 } as User]
      }));

      await expect(service.join("session-uuid", 2)).rejects.toBeInstanceOf(
        MultiplayerUserAlreadyJoinedError
      );
    });

    it("joins a public session and returns a slave ticket", async () => {
      gameSession.findUnique.mockResolvedValue(makeSession());
      gameSession.update.mockResolvedValue(makeSession());

      const result = await service.join("session-uuid", 2);

      expect(result.connectionTicket).toBe("signed.ticket");
      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { otherUsers: { connect: { id: 2 } } }
        })
      );
    });
  });

  describe("host-only actions", () => {
    it("update is forbidden for a non-host", async () => {
      gameSession.findUnique.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(
        service.update("session-uuid", 999, { title: "new" })
      ).rejects.toBeInstanceOf(MultiplayerForbiddenError);
    });

    it("delete is forbidden for a non-host", async () => {
      gameSession.findUnique.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(service.delete("session-uuid", 999)).rejects.toBeInstanceOf(
        MultiplayerForbiddenError
      );
    });

    it("delete tears down the session and closes the room", async () => {
      gameSession.findUnique.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      gameSession.delete.mockResolvedValueOnce(makeSession());

      await service.delete("session-uuid", 1);

      expect(gameSession.delete).toHaveBeenCalledWith({
        where: { sessionId: "session-uuid" }
      });
    });
  });
});
