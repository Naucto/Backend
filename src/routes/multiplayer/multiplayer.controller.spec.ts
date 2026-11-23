import { Test } from '@nestjs/testing';
import { GameSessionVisibility } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { RequestWithUser } from '../../auth/auth.types';
import { SESSION_ROSTER_PREVIEW } from './dto/game-session-limits';
import { MultiplayerController } from './multiplayer.controller';
import { GameSessionEx, MultiplayerService } from './multiplayer.service';

function makeSession(overrides: Partial<GameSessionEx> = {}): GameSessionEx {
  return {
    id: uuidOf(1),
    hostId: uuidOf(1),
    projectId: uuidOf(1),
    startedAt: new Date(),
    endedAt: null,
    title: 'My session',
    maxPlayers: 4,
    visibility: GameSessionVisibility.PUBLIC,
    joinCode: null,
    sessionId: 'session-uuid',
    host: { id: uuidOf(1), username: 'alice', nickname: null },
    project: {
      id: uuidOf(1),
      name: 'Snake',
      publishedName: null,
      iconUrl: null,
      coverVersion: null,
      clipVersion: null,
      diskColor: null,
      diskFinish: null,
      diskColor2: null,
      diskGradDir: null,
    },
    otherUsers: [],
    ...overrides,
  };
}

describe('MultiplayerController', () => {
  let controller: MultiplayerController;

  const multiplayerService = {
    get: jest.fn(),
    connectedPlayerCount: jest.fn(),
    lookOf: jest.fn(),
  };
  const req = { user: { id: uuidOf(1) } } as RequestWithUser;

  beforeEach(async () => {
    jest.resetAllMocks();
    multiplayerService.connectedPlayerCount.mockReturnValue(0);
    multiplayerService.lookOf.mockReturnValue({ coverUrl: null, clipUrl: null, disk: null });

    const module = await Test.createTestingModule({
      controllers: [MultiplayerController],
      providers: [{ provide: MultiplayerService, useValue: multiplayerService }],
    }).compile();

    controller = module.get(MultiplayerController);
  });

  describe('session response', () => {
    it('counts the players connected to the room', async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ otherUsers: [{ id: uuidOf(2), username: 'bob', nickname: null }] }),
      );
      multiplayerService.connectedPlayerCount.mockReturnValueOnce(3);

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({
        playerCount: 3,
      });
    });

    it('counts the host and the members when nobody is connected', async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({ otherUsers: [{ id: uuidOf(2), username: 'bob', nickname: null }] }),
      );

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({
        playerCount: 2,
      });
    });

    it('names the game as it was published, not by its working name', async () => {
      multiplayerService.get.mockResolvedValueOnce(
        makeSession({
          project: { ...makeSession().project, name: 'snake-wip', publishedName: 'Snake' },
        }),
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

    it('names at most eight players, the host first, with a nickname only where one is set', async () => {
      const guests = Array.from({ length: SESSION_ROSTER_PREVIEW + 2 }, (_, index) => ({
        id: uuidOf(index + 2),
        username: `guest-${index}`,
        nickname: index === 0 ? 'Bobby' : null,
      }));
      multiplayerService.get.mockResolvedValueOnce(makeSession({ otherUsers: guests }));

      const { roster, playerCount } = await controller.get(req, 'session-uuid');

      expect(roster).toHaveLength(SESSION_ROSTER_PREVIEW);
      expect(roster.slice(0, 2)).toEqual([
        { id: uuidOf(1), username: 'alice' },
        { id: uuidOf(2), username: 'guest-0', nickname: 'Bobby' },
      ]);
      expect(playerCount).toBe(guests.length + 1);
    });

    it('says when the session was opened and how its game is drawn', async () => {
      const startedAt = new Date('2026-11-20T18:30:00Z');
      const session = makeSession({ startedAt });
      const disk = { color: '#ff8426', finish: 'solid' };
      multiplayerService.get.mockResolvedValueOnce(session);
      multiplayerService.lookOf.mockReturnValueOnce({
        coverUrl: 'https://cdn.test/projects/1/image?v=abc',
        clipUrl: null,
        disk,
      });

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({
        startedAt,
        coverUrl: 'https://cdn.test/projects/1/image?v=abc',
        disk,
      });
      expect(multiplayerService.lookOf).toHaveBeenCalledWith(session);
    });

    it('answers a game without a chosen disk with none', async () => {
      multiplayerService.get.mockResolvedValueOnce(makeSession());

      await expect(controller.get(req, 'session-uuid')).resolves.toMatchObject({ disk: null });
    });

    it('hands the join code it was given to the lookup', async () => {
      multiplayerService.get.mockResolvedValueOnce(makeSession());

      await controller.get(req, 'session-uuid', 'ABCDEFGH');

      expect(multiplayerService.get).toHaveBeenCalledWith('session-uuid', uuidOf(1), 'ABCDEFGH');
    });
  });
});
