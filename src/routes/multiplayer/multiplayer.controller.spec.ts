import { Test } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from "@nestjs/common";
import { GameSessionVisibility } from "@prisma/client";

import { RequestWithUser } from "@auth/auth.types";

import { MultiplayerController } from "./multiplayer.controller";
import { GameSessionEx, MultiplayerService } from "./multiplayer.service";
import {
  MultiplayerForbiddenError,
  MultiplayerGameSessionNotFoundError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotFoundError,
  MultiplayerUserNotInSessionError
} from "./multiplayer.error";

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

describe("MultiplayerController", () => {
  let controller: MultiplayerController;

  const multiplayerService = { get: jest.fn(), connectedPlayerCount: jest.fn() };
  const req = { user: { id: 1 } } as RequestWithUser;

  beforeEach(async () => {
    jest.resetAllMocks();
    multiplayerService.connectedPlayerCount.mockReturnValue(0);

    const module = await Test.createTestingModule({
      controllers: [MultiplayerController],
      providers: [{ provide: MultiplayerService, useValue: multiplayerService }]
    }).compile();

    controller = module.get(MultiplayerController);
  });

  describe("errors", () => {
    it.each([
      [new MultiplayerGameSessionNotFoundError("no session"), NotFoundException],
      [new MultiplayerUserNotFoundError("no user"), NotFoundException],
      [new MultiplayerForbiddenError("not yours"), ForbiddenException],
      [new MultiplayerUserAlreadyJoinedError("already in"), ConflictException],
      [new MultiplayerSessionFullError("full"), ConflictException],
      [new MultiplayerInvalidJoinCodeError("wrong code"), BadRequestException],
      [new MultiplayerUserNotInSessionError("not in"), BadRequestException]
    ])("answers %p with its own status and message", async (thrown, status) => {
      multiplayerService.get.mockRejectedValueOnce(thrown);

      const answer = controller.get(req, "session-uuid");

      await expect(answer).rejects.toBeInstanceOf(status);
      await expect(answer).rejects.toThrow(thrown.message);
    });

    it("lets an HTTP exception raised beneath it through unchanged", async () => {
      const thrown = new NotFoundException("Project with ID 99 not found");
      multiplayerService.get.mockRejectedValueOnce(thrown);

      await expect(controller.get(req, "session-uuid")).rejects.toBe(thrown);
    });

    it("answers an unknown failure with a 500 that says nothing of its cause", async () => {
      const logged = jest
        .spyOn(Logger.prototype, "error")
        .mockImplementation(() => undefined);
      const thrown = new Error("Invalid `gameSession.create()` invocation");
      multiplayerService.get.mockRejectedValueOnce(thrown);

      const answer = controller.get(req, "session-uuid");

      await expect(answer).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(answer).rejects.not.toThrow(/gameSession/);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(expect.any(String), thrown.stack);

      logged.mockRestore();
    });
  });

  describe("session response", () => {
    it("counts the players connected to the room", async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ otherUsers: [{ id: 2, username: "bob", nickname: null }] })
      );
      multiplayerService.connectedPlayerCount.mockReturnValueOnce(3);

      await expect(controller.get(req, "session-uuid")).resolves.toMatchObject({
        playerCount: 3
      });
    });

    it("counts the host and the members when nobody is connected", async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ otherUsers: [{ id: 2, username: "bob", nickname: null }] })
      );

      await expect(controller.get(req, "session-uuid")).resolves.toMatchObject({
        playerCount: 2
      });
    });

    it("names the game as it was published, not by its working name", async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ project: { name: "snake-wip", publishedName: "Snake" } })
      );

      await expect(controller.get(req, "session-uuid")).resolves.toMatchObject({
        projectName: "Snake"
      });
    });

    it("names an unpublished game by its working name", async () => {
      multiplayerService.get.mockResolvedValueOnce(makeSession());

      await expect(controller.get(req, "session-uuid")).resolves.toMatchObject({
        projectName: "Snake"
      });
    });
  });
});
