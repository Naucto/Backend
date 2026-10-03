import { Test } from "@nestjs/testing";
import { Logger, NotFoundException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { GameSession, GameSessionVisibility, Prisma, User } from "@prisma/client";

import { ProjectService } from "@project/project.service";
import { PrismaService } from "@ourPrisma/prisma.service";
import { WebRTCService } from "@webrtc/webrtc.service";

import { MultiplayerService } from "./multiplayer.service";
import { FriendsService } from "@friends/friends.service";
import { NotificationsService } from "src/notifications/notifications.service";
import { SyncedGameTableWebRTCServer } from "@webrtc/server/webrtc.server.synced-game-table";
import {
  MultiplayerForbiddenError,
  MultiplayerGameSessionNotFoundError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerInvalidStateError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotFoundError,
  MultiplayerUserNotInSessionError
} from "./multiplayer.error";

// Avoid spinning up a real WebRTC/HTTP server during the service constructor.
jest.mock("@webrtc/server/webrtc.server.synced-game-table");

const SyncedGameTableServerMock =
  SyncedGameTableWebRTCServer as unknown as jest.Mock;

type Player = { id: number; username: string; nickname: string | null };
type GameSessionEx = GameSession & {
  otherUsers: Player[];
  host: Player;
  project: { name: string; publishedName: string | null };
};

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
    host: { id: 1, username: "alice", nickname: null },
    project: { name: "Snake", publishedName: null },
    otherUsers: [],
    ...overrides
  };
}

function makeProject(
  overrides: Partial<{
    publishedAt: Date | null;
    creator: { id: number };
    collaborators: { id: number }[];
  }> = {}
): object {
  return {
    id: 1,
    publishedAt: null,
    creator: { id: 1 },
    collaborators: [],
    ...overrides
  };
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("refused", {
    code,
    clientVersion: "test"
  });
}

describe("MultiplayerService", () => {
  let service: MultiplayerService;

  const gameSession = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn()
  };
  const $transaction = jest.fn();

  const user = { findUnique: jest.fn() };
  const project = { count: jest.fn() };
  const notificationsService = { createNotification: jest.fn() };
  const friendsService = { areFriends: jest.fn(), friendIdsOf: jest.fn() };
  const projectService = { findOne: jest.fn() };
  const webrtcService = { buildOffer: jest.fn() };
  const jwtService = { sign: jest.fn(), verify: jest.fn() };

  function mintedPayload(): { userId: number; role: string } {
    return jwtService.sign.mock.calls[0]![0] as { userId: number; role: string };
  }

  function server(): { closeRoom: jest.Mock } {
    return SyncedGameTableServerMock.mock.results[0]!.value as {
      closeRoom: jest.Mock;
    };
  }

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
    user.findUnique.mockResolvedValue({ sessionJoinPolicy: "ANYONE" });
    project.count.mockResolvedValue(0);
    friendsService.areFriends.mockResolvedValue(false);
    friendsService.friendIdsOf.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        MultiplayerService,
        { provide: ProjectService, useValue: projectService },
        { provide: WebRTCService, useValue: webrtcService },
        {
          provide: PrismaService,
          useValue: { gameSession, user, project, $transaction }
        },
        { provide: JwtService, useValue: jwtService },
        { provide: FriendsService, useValue: friendsService },
        { provide: NotificationsService, useValue: notificationsService }
      ]
    }).compile();

    service = module.get<MultiplayerService>(MultiplayerService);
  });

  describe("create", () => {
    it("throws if the project does not exist", async () => {
      projectService.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        service.create(1, {
          projectId: 99,
          title: "x",
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC
        })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("refuses to host an unpublished project the caller does not work on", async () => {
      projectService.findOne.mockResolvedValueOnce(
        makeProject({ creator: { id: 7 }, collaborators: [{ id: 8 }] })
      );

      await expect(
        service.create(1, {
          projectId: 1,
          title: "x",
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC
        })
      ).rejects.toBeInstanceOf(MultiplayerForbiddenError);
      expect(gameSession.create).not.toHaveBeenCalled();
    });

    it("lets a collaborator host an unpublished project", async () => {
      projectService.findOne.mockResolvedValueOnce(
        makeProject({ creator: { id: 7 }, collaborators: [{ id: 1 }] })
      );
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockResolvedValueOnce(makeSession());

      await expect(
        service.create(1, {
          projectId: 1,
          title: "x",
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC
        })
      ).resolves.toMatchObject({ sessionUuid: "session-uuid" });
    });

    it("lets anyone host a published project", async () => {
      projectService.findOne.mockResolvedValueOnce(
        makeProject({ creator: { id: 7 }, publishedAt: new Date() })
      );
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockResolvedValueOnce(makeSession());

      await expect(
        service.create(1, {
          projectId: 1,
          title: "x",
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC
        })
      ).resolves.toMatchObject({ sessionUuid: "session-uuid" });
    });

    it("ends the host's previous session before creating a new one", async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
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
      expect(server().closeRoom).toHaveBeenCalledWith("old-uuid");
      expect(gameSession.create).toHaveBeenCalled();
    });

    it("creates a session and returns a connection ticket", async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
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
      projectService.findOne.mockResolvedValueOnce(makeProject());
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

    it("draws another join code when the first one is already taken", async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create
        .mockRejectedValueOnce(prismaError("P2002"))
        .mockImplementationOnce(
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

      const [taken, drawn] = gameSession.create.mock.calls.map(
        ([arg]) => (arg as { data: { joinCode: string } }).data.joinCode
      );
      expect(gameSession.create).toHaveBeenCalledTimes(2);
      expect(drawn).not.toBe(taken);
      expect(result.joinCode).toBe(drawn);
    });
  });

  describe("host join policy", () => {
    it("forces INVITE_CODE and mints a join code for a CODE_ONLY host", async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(null);
      user.findUnique.mockResolvedValueOnce({ sessionJoinPolicy: "CODE_ONLY" });
      gameSession.create.mockImplementationOnce(
        ({ data }: { data: { joinCode: string; visibility: string } }) =>
          Promise.resolve(
            makeSession({
              visibility: data.visibility as GameSessionVisibility,
              joinCode: data.joinCode
            })
          )
      );

      const result = await service.create(1, {
        projectId: 1,
        title: "x",
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC
      });

      expect(gameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.INVITE_CODE,
            joinCode: expect.any(String)
          })
        })
      );
      expect(result.joinCode).toHaveLength(8);
    });

    it("raises PUBLIC to FRIENDS_ONLY for a FRIENDS host but keeps a stricter choice", async () => {
      projectService.findOne.mockResolvedValue(makeProject());
      gameSession.findFirst.mockResolvedValue(null);
      user.findUnique.mockResolvedValue({ sessionJoinPolicy: "FRIENDS" });
      gameSession.create.mockResolvedValue(makeSession());

      await service.create(1, {
        projectId: 1,
        title: "x",
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC
      });
      expect(gameSession.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.FRIENDS_ONLY
          })
        })
      );

      gameSession.create.mockImplementationOnce(
        ({ data }: { data: { joinCode: string } }) =>
          Promise.resolve(makeSession({ joinCode: data.joinCode }))
      );
      await service.create(1, {
        projectId: 1,
        title: "x",
        maxPlayers: 4,
        visibility: GameSessionVisibility.INVITE_CODE
      });
      expect(gameSession.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.INVITE_CODE
          })
        })
      );
    });

    it("applies the floor on update too", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      user.findUnique.mockResolvedValueOnce({ sessionJoinPolicy: "FRIENDS" });
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update("session-uuid", 1, {
        visibility: GameSessionVisibility.PUBLIC
      });

      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.FRIENDS_ONLY
          })
        })
      );
    });
  });

  describe("update (join code)", () => {
    it("mints a code when a session without one becomes invite-only", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update("session-uuid", 1, {
        visibility: GameSessionVisibility.INVITE_CODE
      });

      const { data } = gameSession.update.mock.calls[0]![0] as {
        data: { joinCode: string };
      };
      expect(data.joinCode).toMatch(/^[A-Z2-9]{8}$/);
    });

    it("keeps the code a session was given when it becomes listed", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: "ABCDEFGH"
        })
      );
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update("session-uuid", 1, {
        visibility: GameSessionVisibility.PUBLIC
      });

      expect(gameSession.update).toHaveBeenCalledWith({
        where: { sessionId: "session-uuid" },
        data: { visibility: GameSessionVisibility.PUBLIC }
      });
    });

    it("keeps the same code when a listed session goes back to invite-only", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          visibility: GameSessionVisibility.PUBLIC,
          joinCode: "ABCDEFGH"
        })
      );
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update("session-uuid", 1, {
        visibility: GameSessionVisibility.INVITE_CODE
      });

      expect(gameSession.update).toHaveBeenCalledWith({
        where: { sessionId: "session-uuid" },
        data: { visibility: GameSessionVisibility.INVITE_CODE }
      });
    });
  });

  describe("friends-only sessions", () => {
    it("lists FRIENDS_ONLY sessions only to the host's friends", async () => {
      gameSession.findMany.mockResolvedValue([
        makeSession({ hostId: 1, visibility: GameSessionVisibility.FRIENDS_ONLY })
      ]);

      friendsService.friendIdsOf.mockResolvedValueOnce([]);
      await expect(service.list(1, 2)).resolves.toHaveLength(0);

      friendsService.friendIdsOf.mockResolvedValueOnce([1]);
      await expect(service.list(1, 2)).resolves.toHaveLength(1);
      expect(friendsService.friendIdsOf).toHaveBeenCalledWith(2);
    });

    it("lists a FRIENDS_ONLY session to a member who is not the host's friend", async () => {
      gameSession.findMany.mockResolvedValueOnce([
        makeSession({
          hostId: 1,
          visibility: GameSessionVisibility.FRIENDS_ONLY,
          otherUsers: [{ id: 2 } as User]
        })
      ]);

      await expect(service.list(1, 2)).resolves.toHaveLength(1);
    });

    it("asks for the caller's friends once however many sessions are open", async () => {
      gameSession.findMany.mockResolvedValueOnce([
        makeSession({
          sessionId: "a",
          hostId: 5,
          visibility: GameSessionVisibility.FRIENDS_ONLY
        }),
        makeSession({
          sessionId: "b",
          hostId: 6,
          visibility: GameSessionVisibility.FRIENDS_ONLY
        }),
        makeSession({
          sessionId: "c",
          hostId: 7,
          visibility: GameSessionVisibility.FRIENDS_ONLY
        })
      ]);
      friendsService.friendIdsOf.mockResolvedValueOnce([5, 7]);

      const sessions = await service.list(undefined, 2);

      expect(sessions.map((session) => session.sessionId)).toEqual(["a", "c"]);
      expect(friendsService.friendIdsOf).toHaveBeenCalledTimes(1);
      expect(friendsService.areFriends).not.toHaveBeenCalled();
    });

    it("lets a friend join and blocks a stranger", async () => {
      const session = makeSession({
        hostId: 1,
        visibility: GameSessionVisibility.FRIENDS_ONLY
      });
      gameSession.findFirst.mockResolvedValue(session);
      gameSession.findUnique.mockResolvedValue(session);
      gameSession.update.mockResolvedValue(session);

      friendsService.areFriends.mockResolvedValueOnce(false);
      await expect(service.join("session-uuid", 2)).rejects.toBeInstanceOf(
        MultiplayerForbiddenError
      );

      friendsService.areFriends.mockResolvedValueOnce(true);
      await expect(service.join("session-uuid", 2)).resolves.toMatchObject({
        connectionTicket: "signed.ticket"
      });
    });

    it("lets a friend fetch a FRIENDS_ONLY session", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: 1, visibility: GameSessionVisibility.FRIENDS_ONLY })
      );
      friendsService.areFriends.mockResolvedValueOnce(true);

      await expect(service.get("session-uuid", 2)).resolves.toBeDefined();
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
      // The session is read once to find it, and again inside the transaction for the capacity check.
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

    it("hands a returning member a fresh connection under their own id", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          otherUsers: [{ id: 2 } as User]
        })
      );

      const result = await service.join("session-uuid", 2);

      expect(result.playerId).toBe(2);
      expect(mintedPayload()).toMatchObject({ userId: 2, role: "slave" });
      expect($transaction).not.toHaveBeenCalled();
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

    it("connects nobody twice when a concurrent join got there first", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValueOnce(
        makeSession({ otherUsers: [{ id: 2 } as User] })
      );

      await expect(service.join("session-uuid", 2)).resolves.toMatchObject({
        playerId: 2
      });
      expect(gameSession.update).not.toHaveBeenCalled();
    });

    it("reports a session that ended while the join was in flight", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValueOnce(
        makeSession({ endedAt: new Date() })
      );

      await expect(service.join("session-uuid", 2)).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError
      );
      expect(gameSession.update).not.toHaveBeenCalled();
    });

    it("retries a join that lost a serialization race", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValue(makeSession());
      gameSession.update.mockResolvedValue(makeSession());
      $transaction
        .mockRejectedValueOnce(prismaError("P2034"))
        .mockRejectedValueOnce(prismaError("P2034"));

      await expect(service.join("session-uuid", 2)).resolves.toMatchObject({
        playerId: 2
      });
      expect($transaction).toHaveBeenCalledTimes(3);
    });

    it("gives up on a join that keeps losing the race", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      $transaction.mockRejectedValue(prismaError("P2034"));

      await expect(service.join("session-uuid", 2)).rejects.toBeInstanceOf(
        MultiplayerInvalidStateError
      );
      expect($transaction).toHaveBeenCalledTimes(5);
    });

    it("does not retry a join that failed for another reason", async () => {
      const failure = prismaError("P2025");
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      $transaction.mockRejectedValue(failure);

      await expect(service.join("session-uuid", 2)).rejects.toBe(failure);
      expect($transaction).toHaveBeenCalledTimes(1);
    });

    it("lets the host self-join as a synthetic player when editorTest is set", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      const result = await service.join("session-uuid", 1, undefined, true);

      expect(result.connectionTicket).toBe("signed.ticket");
      expect(gameSession.update).not.toHaveBeenCalled();
      const payload = mintedPayload();
      expect(payload.role).toBe("slave");
      expect(payload.userId).toBeGreaterThan(0);
      expect(payload.userId).not.toBe(1);
    });

    it("still blocks a self-join without the editorTest flag", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(service.join("session-uuid", 1)).rejects.toBeInstanceOf(
        MultiplayerUserAlreadyJoinedError
      );
    });

    it("gives a non-host member their own seat, never a synthetic one, when editorTest is set", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: 1, otherUsers: [{ id: 2 } as User] })
      );

      const result = await service.join("session-uuid", 2, undefined, true);

      expect(result.playerId).toBe(2);
      expect(mintedPayload()).toMatchObject({ userId: 2, role: "slave" });
    });
  });

  describe("account rows", () => {
    function shown(relation: unknown): string[] {
      expect(relation).toEqual({ select: expect.any(Object) });

      return Object.keys((relation as { select: object }).select).sort();
    }

    it("reads only the public face of the host and the members", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());

      await service.get("session-uuid", 1);

      const { include } = gameSession.findFirst.mock.calls[0]![0] as {
        include: { host: unknown; otherUsers: unknown };
      };
      expect(shown(include.host)).toEqual(["id", "nickname", "username"]);
      expect(shown(include.otherUsers)).toEqual(["id", "nickname", "username"]);
    });

    it("reads only ids when it re-checks membership inside the join", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValueOnce(makeSession());
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.join("session-uuid", 2);

      const { include } = gameSession.findUnique.mock.calls[0]![0] as {
        include: { otherUsers: unknown };
      };
      expect(shown(include.otherUsers)).toEqual(["id"]);
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
      expect(server().closeRoom).toHaveBeenCalledWith("session-uuid");
    });
  });

  describe("get (visibility access control)", () => {
    it("hides a FRIENDS_ONLY session from a non-member (404)", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          visibility: GameSessionVisibility.FRIENDS_ONLY
        })
      );

      await expect(service.get("session-uuid", 99)).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError
      );
    });

    it("hides an INVITE_CODE session from a non-member (404)", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: "ABCDEFGH"
        })
      );

      await expect(service.get("session-uuid", 99)).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError
      );
    });

    it("returns a non-public session for one of its members", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          visibility: GameSessionVisibility.FRIENDS_ONLY,
          otherUsers: [{ id: 2 } as User]
        })
      );

      const session = await service.get("session-uuid", 2);

      expect(session.sessionId).toBe("session-uuid");
    });

    it("returns a PUBLIC session for a non-member", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: 1, visibility: GameSessionVisibility.PUBLIC })
      );

      const session = await service.get("session-uuid", 99);

      expect(session.sessionId).toBe("session-uuid");
    });
  });

  describe("roster", () => {
    it("names the host first, then everyone who joined", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          host: { id: 1, username: "alice", nickname: "Ali" },
          otherUsers: [
            { id: 2, username: "bob", nickname: null },
            { id: 3, username: "cleo", nickname: "Cle" }
          ]
        })
      );

      await expect(service.roster("session-uuid", 2)).resolves.toEqual({
        players: [
          { userId: 1, username: "alice", nickname: "Ali", host: true },
          { userId: 2, username: "bob", nickname: null, host: false },
          { userId: 3, username: "cleo", nickname: "Cle", host: false }
        ],
        maxPlayers: 4
      });
    });

    it("does not leak the roster of a session the caller cannot discover", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: "ABCDEFGH"
        })
      );

      await expect(service.roster("session-uuid", 99)).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError
      );
    });
  });

  describe("invite", () => {
    const inviteOnly = (): GameSessionEx =>
      makeSession({
        hostId: 1,
        projectId: 9,
        visibility: GameSessionVisibility.INVITE_CODE,
        joinCode: "ABCDEFGH"
      });

    it("notifies a friend with the code that gets them in", async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      friendsService.areFriends.mockResolvedValueOnce(true);

      await service.invite("session-uuid", 1, 42);

      expect(friendsService.areFriends).toHaveBeenCalledWith(1, 42);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          data: expect.objectContaining({
            sessionId: "session-uuid",
            joinCode: "ABCDEFGH"
          })
        })
      );
    });

    it("notifies someone who works on the game without being a friend", async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      project.count.mockResolvedValueOnce(1);

      await service.invite("session-uuid", 1, 42);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 42 })
      );
    });

    it("refuses to notify someone the host has no tie to", async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());

      await expect(service.invite("session-uuid", 1, 42)).rejects.toBeInstanceOf(
        MultiplayerForbiddenError
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it("reports an invitee that does not exist", async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      user.findUnique.mockResolvedValueOnce(null);
      friendsService.areFriends.mockResolvedValueOnce(true);

      await expect(service.invite("session-uuid", 1, 42)).rejects.toBeInstanceOf(
        MultiplayerUserNotFoundError
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it("reports an invitee whose account was deleted", async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      user.findUnique.mockResolvedValueOnce({ deletedAt: new Date() });
      friendsService.areFriends.mockResolvedValueOnce(true);

      await expect(service.invite("session-uuid", 1, 42)).rejects.toBeInstanceOf(
        MultiplayerUserNotFoundError
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it("names the game as the hub shows it, not by its working name", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          project: { name: "snake-wip", publishedName: "Snake" }
        })
      );
      friendsService.areFriends.mockResolvedValueOnce(true);

      await service.invite("session-uuid", 1, 42);

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: "alice invited you to play Snake" })
      );
    });

    it("refuses an invite from anyone but the host", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(service.invite("session-uuid", 99, 42)).rejects.toBeInstanceOf(
        MultiplayerForbiddenError
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });

  describe("list (visibility filtering)", () => {
    it("returns PUBLIC sessions but omits FRIENDS_ONLY and INVITE_CODE", async () => {
      gameSession.findMany.mockResolvedValueOnce([
        makeSession({
          sessionId: "public-uuid",
          visibility: GameSessionVisibility.PUBLIC
        }),
        makeSession({
          sessionId: "friends-uuid",
          visibility: GameSessionVisibility.FRIENDS_ONLY
        }),
        makeSession({
          sessionId: "invite-uuid",
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: "ABCDEFGH"
        })
      ]);

      const sessions = await service.list(1, 99);

      expect(sessions.map((session) => session.sessionId)).toEqual([
        "public-uuid"
      ]);
    });

    it("asks about every game when no project is named", async () => {
      gameSession.findMany.mockResolvedValueOnce([]);

      await service.list(undefined, 99);

      expect(gameSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { endedAt: null } })
      );
    });

    it("matches a term against the room's name and both names of the game", async () => {
      gameSession.findMany.mockResolvedValueOnce([]);

      await service.list(undefined, 99, " arena ");

      const calls = gameSession.findMany.mock.calls;
      const where = calls[calls.length - 1]![0].where;
      expect(where.OR).toEqual([
        { title: { contains: "arena", mode: "insensitive" } },
        { project: { publishedName: { contains: "arena", mode: "insensitive" } } },
        { project: { name: { contains: "arena", mode: "insensitive" } } }
      ]);
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

    it("still gets a player in by the code once the session is listed", async () => {
      const listed = makeSession({
        visibility: GameSessionVisibility.PUBLIC,
        joinCode: "ABCDEFGH"
      });
      gameSession.findFirst.mockResolvedValue(listed);
      gameSession.findUnique.mockResolvedValue(listed);
      gameSession.update.mockResolvedValue(listed);

      await expect(service.joinByCode("ABCDEFGH", 2)).resolves.toMatchObject({
        playerId: 2
      });
    });
  });

  describe("refreshTicket", () => {
    it("mints a fresh ticket for a joined slave", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: 1, otherUsers: [{ id: 2 } as User] })
      );

      const result = await service.refreshTicket("session-uuid", 2);

      expect(result.playerId).toBe(2);
      expect(mintedPayload()).toMatchObject({ userId: 2, role: "slave" });
    });

    it("rejects a non-member", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(
        service.refreshTicket("session-uuid", 99)
      ).rejects.toBeInstanceOf(MultiplayerUserNotInSessionError);
    });

    // A ticket is minted for a connection: the editor's test rig plays under a
    // synthetic id its ticket alone remembers.
    const RIG_TICKET = {
      kind: "game-table",
      sessionId: "session-uuid",
      userId: 123456789,
      role: "slave",
      maxPlayers: 4
    };

    it("keeps the rig client's synthetic id and slave role when it presents its ticket", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      jwtService.verify.mockReturnValueOnce(RIG_TICKET);

      const result = await service.refreshTicket("session-uuid", 1, "old.ticket");

      expect(jwtService.verify).toHaveBeenCalledWith("old.ticket", {
        ignoreExpiration: true
      });
      expect(result.playerId).toBe(123456789);
      expect(mintedPayload()).toMatchObject({ userId: 123456789, role: "slave" });
    });

    it("mints from the account when no ticket is given", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      const result = await service.refreshTicket("session-uuid", 1);

      expect(jwtService.verify).not.toHaveBeenCalled();
      expect(result.playerId).toBe(1);
      expect(mintedPayload()).toMatchObject({ userId: 1, role: "host" });
    });

    it("ignores a ticket minted for another session", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      jwtService.verify.mockReturnValueOnce({
        ...RIG_TICKET,
        sessionId: "other-session"
      });

      const result = await service.refreshTicket("session-uuid", 1, "old.ticket");

      expect(result.playerId).toBe(1);
      expect(mintedPayload()).toMatchObject({ userId: 1, role: "host" });
    });

    it("ignores a ticket it cannot verify", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      jwtService.verify.mockImplementationOnce(() => {
        throw new Error("invalid signature");
      });

      const result = await service.refreshTicket("session-uuid", 1, "forged");

      expect(result.playerId).toBe(1);
      expect(mintedPayload()).toMatchObject({ userId: 1, role: "host" });
    });

    it("does not hand a member the host's seat for presenting the host's ticket", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: 1, otherUsers: [{ id: 2 } as User] })
      );
      jwtService.verify.mockReturnValueOnce({
        ...RIG_TICKET,
        userId: 1,
        role: "host"
      });

      const result = await service.refreshTicket("session-uuid", 2, "host.ticket");

      expect(result.playerId).toBe(2);
      expect(mintedPayload()).toMatchObject({ userId: 2, role: "slave" });
    });

    it("does not hand a member another member's seat", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: 1,
          otherUsers: [{ id: 2 } as User, { id: 3 } as User]
        })
      );
      jwtService.verify.mockReturnValueOnce({ ...RIG_TICKET, userId: 3 });

      const result = await service.refreshTicket("session-uuid", 2, "other.ticket");

      expect(result.playerId).toBe(2);
      expect(mintedPayload()).toMatchObject({ userId: 2, role: "slave" });
    });

    it("still rejects a non-member holding a ticket", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));
      jwtService.verify.mockReturnValueOnce(RIG_TICKET);

      await expect(
        service.refreshTicket("session-uuid", 99, "old.ticket")
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

    it("logs a failure instead of throwing it", async () => {
      const logged = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      gameSession.updateMany.mockRejectedValueOnce(new Error("database is gone"));

      await expect(service.endSession("session-uuid")).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining("database is gone")
      );

      logged.mockRestore();
    });
  });

  describe("reapStaleSessions", () => {
    it("soft-ends orphaned sessions left active past the max lifetime", async () => {
      jest.spyOn(service, "connectedPlayerCount").mockReturnValue(0);
      gameSession.findMany.mockResolvedValueOnce([
        { sessionId: "stale-1" },
        { sessionId: "stale-2" }
      ]);
      gameSession.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.reapStaleSessions();

      const findArg = gameSession.findMany.mock.calls[0]![0] as {
        where: { endedAt: null; startedAt: { lt: Date } };
      };
      expect(findArg.where.endedAt).toBeNull();
      expect(findArg.where.startedAt.lt).toBeInstanceOf(Date);
      expect(gameSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: { in: ["stale-1", "stale-2"] } }
        })
      );
      expect(server().closeRoom).toHaveBeenCalledWith("stale-1");
      expect(server().closeRoom).toHaveBeenCalledWith("stale-2");
    });

    it("leaves a still-live long-running session untouched", async () => {
      jest
        .spyOn(service, "connectedPlayerCount")
        .mockImplementation((sessionId) => (sessionId === "live" ? 3 : 0));
      gameSession.findMany.mockResolvedValueOnce([{ sessionId: "live" }]);

      await service.reapStaleSessions();

      expect(gameSession.updateMany).not.toHaveBeenCalled();
      expect(server().closeRoom).not.toHaveBeenCalled();
    });
  });

  describe("game-table server", () => {
    it("ends the session when the server reports its host gone", () => {
      gameSession.updateMany.mockResolvedValueOnce({ count: 1 });
      const hostGone = SyncedGameTableServerMock.mock.calls[0]![3] as (
        sessionId: string
      ) => void;

      hostGone("session-uuid");

      expect(gameSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: "session-uuid", endedAt: null }
        })
      );
    });

    it("is given a verifier that reads the seat a ticket was minted for", () => {
      const seat = {
        sessionId: "session-uuid",
        userId: 2,
        role: "slave",
        maxPlayers: 4
      };
      jwtService.verify.mockReturnValueOnce({ kind: "game-table", ...seat });
      const verify = SyncedGameTableServerMock.mock.calls[0]![2] as (
        raw: string
      ) => unknown;

      expect(verify("signed.ticket")).toEqual(seat);
    });

    it("is given a verifier that refuses a token signed for something else", () => {
      jwtService.verify.mockReturnValueOnce({ sub: 1, email: "alice@example.org" });
      const verify = SyncedGameTableServerMock.mock.calls[0]![2] as (
        raw: string
      ) => unknown;

      expect(() => verify("access.token")).toThrow(MultiplayerInvalidStateError);
    });
  });

  describe("leave", () => {
    it("rejects the host trying to leave", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(service.leave("session-uuid", 1)).rejects.toBeInstanceOf(
        MultiplayerUserNotInSessionError
      );
    });

    it("rejects a non-member trying to leave", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: 1 }));

      await expect(service.leave("session-uuid", 99)).rejects.toBeInstanceOf(
        MultiplayerUserNotInSessionError
      );
    });

    it("disconnects a member from the session", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: 1, otherUsers: [{ id: 2 } as User] })
      );
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.leave("session-uuid", 2);

      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: "session-uuid" },
          data: { otherUsers: { disconnect: { id: 2 } } }
        })
      );
    });
  });
});
