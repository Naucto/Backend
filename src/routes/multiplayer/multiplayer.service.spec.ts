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
  MultiplayerInvalidJoinCodeError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotInSessionError
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
    updateMany: jest.fn(),
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
    SyncedGameTableServerMock.mockImplementation(() => ({
      closeRoom: jest.fn()
    }));
    webrtcService.buildOffer.mockReturnValue({});
    jwtService.sign.mockReturnValue("signed.ticket");
    $transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({ gameSession })
    );

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

    it("ends the host's previous session before creating a new one", async () => {
      projectService.findOne.mockResolvedValueOnce({ id: 1 });
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ sessionId: "old-uuid" })
      );
      gameSession.updateMany.mockResolvedValueOnce({ count: 1 });
      gameSession.create.mockResolvedValueOnce(makeSession());

      await service.create(1, {
        projectId: 1,
        title: "x",
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC
      });

      expect(gameSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: "old-uuid", endedAt: null } })
      );
      expect(gameSession.create).toHaveBeenCalled();
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
      gameSession.create.mockImplementationOnce(
        ({ data }: { data: { joinCode: string } }) =>
          Promise.resolve(
            makeSession({
              visibility: GameSessionVisibility.INVITE_CODE,
              joinCode: data.joinCode
            })
          )
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
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: "RIGHTCOD"
        })
      );

      await expect(
        service.join("session-uuid", 2, "WRONG")
      ).rejects.toBeInstanceOf(MultiplayerInvalidJoinCodeError);
    });

    it("rejects when the session is full", async () => {
      // _findSessionOrThrow reads via findFirst; the capacity check re-reads
      // inside the transaction via findUnique.
      const full = makeSession({
        maxPlayers: 2,
        otherUsers: [{ id: 5 } as User]
      });
      gameSession.findFirst.mockResolvedValue(full);
      gameSession.findUnique.mockResolvedValue(full);

      await expect(service.join("session-uuid", 2)).rejects.toBeInstanceOf(
        MultiplayerSessionFullError
      );
    });

    it("rejects a user that already joined", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          otherUsers: [{ id: 2 } as User]
        })
      );

      await expect(service.join("session-uuid", 2)).rejects.toBeInstanceOf(
        MultiplayerUserAlreadyJoinedError
      );
    });

    it("joins a public session and returns a slave ticket", async () => {
      gameSession.findFirst.mockResolvedValue(makeSession());
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

    it("lets a member self-join as a synthetic player when editorTest is set", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      const result = await service.join("session-uuid", 1, undefined, true);

      expect(result.connectionTicket).toBe("signed.ticket");
      // Not persisted as a real member, and minted with a distinct negative id.
      expect(gameSession.update).not.toHaveBeenCalled();
      const payload = jwtService.sign.mock.calls[0]![0] as {
        role: string;
        userId: number;
      };
      expect(payload.role).toBe("slave");
      expect(payload.userId).toBeLessThan(0);
    });

    it("still blocks a self-join without the editorTest flag", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(service.join("session-uuid", 1)).rejects.toBeInstanceOf(
        MultiplayerUserAlreadyJoinedError
      );
    });
  });

  describe("host-only actions", () => {
    it("update is forbidden for a non-host", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(
        service.update("session-uuid", 999, { title: "new" })
      ).rejects.toBeInstanceOf(MultiplayerForbiddenError);
    });

    it("delete is forbidden for a non-host", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(service.delete("session-uuid", 999)).rejects.toBeInstanceOf(
        MultiplayerForbiddenError
      );
    });

    it("delete soft-ends the session and closes the room", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      gameSession.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.delete("session-uuid", 1);

      expect(gameSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: "session-uuid", endedAt: null }
        })
      );
    });
  });

  describe("joinByCode", () => {
    it("rejects an unknown code", async () => {
      gameSession.findFirst.mockResolvedValueOnce(null);

      await expect(service.joinByCode("NOPE", 2)).rejects.toBeInstanceOf(
        MultiplayerInvalidJoinCodeError
      );
    });

    it("resolves the session by code and joins it", async () => {
      const invite = makeSession({
        visibility: GameSessionVisibility.INVITE_CODE,
        joinCode: "ABCDEFGH"
      });
      gameSession.findFirst.mockResolvedValue(invite);
      gameSession.findUnique.mockResolvedValue(invite);
      gameSession.update.mockResolvedValue(makeSession());

      const result = await service.joinByCode("ABCDEFGH", 2);

      expect(result.connectionTicket).toBe("signed.ticket");
      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { otherUsers: { connect: { id: 2 } } }
        })
      );
    });
  });

  describe("refreshTicket", () => {
    it("mints a fresh ticket for the host", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      const result = await service.refreshTicket("session-uuid", 1);

      expect(result.connectionTicket).toBe("signed.ticket");
    });

    it("mints a fresh ticket for a joined slave", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: 1, otherUsers: [{ id: 2 } as User] })
      );

      const result = await service.refreshTicket("session-uuid", 2);

      expect(result.connectionTicket).toBe("signed.ticket");
    });

    it("rejects a non-member", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(
        service.refreshTicket("session-uuid", 99)
      ).rejects.toBeInstanceOf(MultiplayerUserNotInSessionError);
    });
  });

  describe("endSession", () => {
    it("soft-ends an active session", async () => {
      gameSession.updateMany.mockResolvedValueOnce({ count: 1 });

      await service.endSession("session-uuid");

      expect(gameSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: "session-uuid", endedAt: null }
        })
      );
    });
  });

  describe("reapStaleSessions", () => {
    it("soft-ends sessions left active past the max lifetime", async () => {
      gameSession.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.reapStaleSessions();

      const arg = gameSession.updateMany.mock.calls[0]![0] as {
        where: { endedAt: null; startedAt: { lt: Date } };
        data: { endedAt: Date };
      };
      expect(arg.where.endedAt).toBeNull();
      expect(arg.where.startedAt.lt).toBeInstanceOf(Date);
      expect(arg.data.endedAt).toBeInstanceOf(Date);
    });
  });
});
