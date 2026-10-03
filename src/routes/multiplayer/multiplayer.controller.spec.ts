import { Test } from '@nestjs/testing';
import { GameSessionVisibility } from '@prisma/client';

import { RequestWithUser } from '../../auth/auth.types';
import { MultiplayerController } from './multiplayer.controller';
import { GameSessionEx, MultiplayerService } from './multiplayer.service';

function makeSession(overrides: Partial<GameSessionEx> = {}): GameSessionEx {
  return {
    id: 1,
    hostId: 1,
    projectId: 1,
    startedAt: new Date(),
    endedAt: null,
    title: 'My session',
    maxPlayers: 4,
    visibility: GameSessionVisibility.PUBLIC,
    joinCode: null,
    sessionId: 'session-uuid',
    host: { id: 1, username: 'alice', nickname: null },
    project: { name: 'Snake', publishedName: null },
    otherUsers: [],
    ...overrides,
  };
}

describe('MultiplayerController', () => {
  let controller: MultiplayerController;

  const multiplayerService = { get: jest.fn(), connectedPlayerCount: jest.fn() };
  const req = { user: { id: 1 } } as RequestWithUser;

  beforeEach(async () => {
    jest.resetAllMocks();
    multiplayerService.connectedPlayerCount.mockReturnValue(0);

    const module = await Test.createTestingModule({
      controllers: [MultiplayerController],
      providers: [{ provide: MultiplayerService, useValue: multiplayerService }],
    }).compile();

    controller = module.get(MultiplayerController);
  });

  describe('session response', () => {
    it('counts the players connected to the room', async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ otherUsers: [{ id: 2, username: 'bob', nickname: null }] }),
      );
      multiplayerService.connectedPlayerCount.mockReturnValueOnce(3);

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({
        playerCount: 3,
      });
    });

    it('counts the host and the members when nobody is connected', async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ otherUsers: [{ id: 2, username: 'bob', nickname: null }] }),
      );

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({
        playerCount: 2,
      });
    });

    it('names the game as it was published, not by its working name', async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ project: { name: 'snake-wip', publishedName: 'Snake' } }),
      );

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({
        projectName: 'Snake',
      });
    });

    it('names an unpublished game by its working name', async () => {
      multiplayerService.get.mockResolvedValueOnce(makeSession());

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({
        projectName: 'Snake',
      });
    });
  });
});
