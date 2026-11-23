import { Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { GameSessionVisibility, Prisma } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { ACTIVITY_CHANGED, ActivityChangedEvent } from '../../common/domain-events';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncedGameTableWebRTCServer } from '../../webrtc/server/webrtc.server.synced-game-table';
import {
  SYNCED_GAME_TABLE_TICKET_KIND,
  SyncedGameTableTicketPayload,
} from '../../webrtc/server/webrtc.server.synced-game-table.ticket';
import { WebRTCService } from '../../webrtc/webrtc.service';
import { FriendsService } from '../friends/friends.service';
import { ProjectService } from '../project/project.service';
import { JOIN_CODE_LENGTH, SESSION_LIST_MAX } from './dto/game-session-limits';
import {
  MultiplayerForbiddenError,
  MultiplayerGameSessionNotFoundError,
  MultiplayerInvalidJoinCodeError,
  MultiplayerInvalidStateError,
  MultiplayerSessionFullError,
  MultiplayerUserAlreadyJoinedError,
  MultiplayerUserNotFoundError,
  MultiplayerUserNotInSessionError,
} from './multiplayer.error';
import { GameSessionEx, MAX_DB_RETRIES, MultiplayerService } from './multiplayer.service';
import { MultiplayerAccountingService } from './multiplayer-accounting.service';

// Avoid spinning up a real WebRTC/HTTP server during the service constructor.
jest.mock('../../webrtc/server/webrtc.server.synced-game-table');

type Player = GameSessionEx['host'];

/**
 * The player number these fixtures give account `uuidOf(account)`: far from `account`, so a test
 * that confuses a seat with the account sitting there fails.
 */
function playerNumberOf(account: number): number {
  return 100 + account;
}

function aPlayer(account: number): Player {
  return { id: uuidOf(account), username: `player-${account}`, nickname: null };
}

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
    host: { ...aPlayer(1), username: 'alice' },
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

function makeProject(
  overrides: Partial<{
    publishedAt: Date | null;
    creator: { id: string };
    collaborators: { id: string }[];
  }> = {},
): object {
  return {
    id: uuidOf(1),
    publishedAt: null,
    creator: { id: uuidOf(1) },
    collaborators: [],
    ...overrides,
  };
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('refused', {
    code,
    clientVersion: 'test',
  });
}

describe('MultiplayerService', () => {
  let service: MultiplayerService;

  const gameSession = {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    updateManyAndReturn: jest.fn(),
  };
  const $transaction = jest.fn();

  const user = { findUnique: jest.fn() };
  const project = { count: jest.fn() };
  const notificationsService = { createNotification: jest.fn() };
  const eventEmitter = { emit: jest.fn() };
  const friendsService = { areFriends: jest.fn(), friendIdsOf: jest.fn() };
  const projectService = { findOne: jest.fn(), lookOf: jest.fn() };
  const webrtcService = { buildOffer: jest.fn() };
  const jwtService = { sign: jest.fn(), verify: jest.fn() };
  const accounting = {
    roomCreated: jest.fn(),
    editorJoined: jest.fn(),
    editorTests: jest.fn(),
    sessionEnded: jest.fn(),
    seatConnected: jest.fn(),
    seatDisconnected: jest.fn(),
    roomClosed: jest.fn(),
  };

  function mintedPayload(): SyncedGameTableTicketPayload {
    return jwtService.sign.mock.calls[0]![0] as SyncedGameTableTicketPayload;
  }

  /** What a seat hands out: to the game its player number, to the room server the account too. */
  function expectSeatOf(
    result: { playerId: number },
    account: number,
    role: SyncedGameTableTicketPayload['role'],
  ): void {
    expect(result.playerId).toBe(playerNumberOf(account));
    expect(mintedPayload()).toMatchObject({
      playerNumber: playerNumberOf(account),
      userId: uuidOf(account),
      role,
    });
  }

  /** The room server the service built, and what the service handed it. */
  function gameTable(): {
    server: jest.Mocked<SyncedGameTableWebRTCServer>;
    verifyTicket: (raw: string) => unknown;
    onHostDisconnected: (sessionId: string) => void;
  } {
    const { mock } = jest.mocked(SyncedGameTableWebRTCServer);
    const [, , verifyTicket, onHostDisconnected] = mock.calls[0]!;

    return {
      server: jest.mocked(mock.instances[0]!),
      verifyTicket,
      onHostDisconnected: onHostDisconnected!,
    };
  }

  beforeEach(async () => {
    // resetAllMocks (not clearAllMocks) also drains queued *Once values, so a
    // mock left unconsumed by one test can't leak into the next.
    jest.resetAllMocks();
    webrtcService.buildOffer.mockReturnValue({});
    jwtService.sign.mockReturnValue('signed.ticket');
    $transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb({ gameSession }));
    user.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({
        sessionJoinPolicy: 'ANYONE',
        playerNumber: playerNumberOf(Number(where.id.slice(-12))),
      }),
    );
    project.count.mockResolvedValue(0);
    friendsService.areFriends.mockResolvedValue(false);
    friendsService.friendIdsOf.mockResolvedValue([]);
    accounting.editorTests.mockResolvedValue(new Set());

    const module = await Test.createTestingModule({
      providers: [
        MultiplayerService,
        { provide: ProjectService, useValue: projectService },
        { provide: WebRTCService, useValue: webrtcService },
        {
          provide: PrismaService,
          useValue: { gameSession, user, project, $transaction },
        },
        { provide: JwtService, useValue: jwtService },
        { provide: FriendsService, useValue: friendsService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: MultiplayerAccountingService, useValue: accounting },
      ],
    }).compile();

    service = module.get<MultiplayerService>(MultiplayerService);
  });

  describe('create', () => {
    it('throws if the project does not exist', async () => {
      projectService.findOne.mockRejectedValueOnce(new NotFoundException());

      await expect(
        service.create(uuidOf(1), {
          projectId: uuidOf(99),
          title: 'x',
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to host an unpublished project the caller does not work on', async () => {
      projectService.findOne.mockResolvedValueOnce(
        makeProject({ creator: { id: uuidOf(7) }, collaborators: [{ id: uuidOf(8) }] }),
      );

      await expect(
        service.create(uuidOf(1), {
          projectId: uuidOf(1),
          title: 'x',
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC,
        }),
      ).rejects.toBeInstanceOf(MultiplayerForbiddenError);
      expect(gameSession.create).not.toHaveBeenCalled();
    });

    it('lets a collaborator host an unpublished project', async () => {
      projectService.findOne.mockResolvedValueOnce(
        makeProject({ creator: { id: uuidOf(7) }, collaborators: [{ id: uuidOf(1) }] }),
      );
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockResolvedValueOnce(makeSession());

      await expect(
        service.create(uuidOf(1), {
          projectId: uuidOf(1),
          title: 'x',
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC,
        }),
      ).resolves.toMatchObject({ sessionUuid: 'session-uuid' });
    });

    it('lets anyone host a published project', async () => {
      projectService.findOne.mockResolvedValueOnce(
        makeProject({ creator: { id: uuidOf(7) }, publishedAt: new Date() }),
      );
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockResolvedValueOnce(makeSession());

      await expect(
        service.create(uuidOf(1), {
          projectId: uuidOf(1),
          title: 'x',
          maxPlayers: 4,
          visibility: GameSessionVisibility.PUBLIC,
        }),
      ).resolves.toMatchObject({ sessionUuid: 'session-uuid' });
    });

    it("ends the host's previous session before creating a new one", async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ sessionId: 'old-uuid' }));
      gameSession.updateManyAndReturn.mockResolvedValueOnce([{ hostId: uuidOf(1) }]);
      gameSession.create.mockResolvedValueOnce(makeSession());

      await service.create(uuidOf(1), {
        projectId: uuidOf(1),
        title: 'x',
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC,
      });

      expect(gameSession.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: 'old-uuid', endedAt: null } }),
      );
      expect(gameTable().server.closeRoom).toHaveBeenCalledWith('old-uuid');
      expect(gameSession.create).toHaveBeenCalled();
    });

    it('creates a session and returns a connection ticket', async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockResolvedValueOnce(makeSession());

      const result = await service.create(uuidOf(1), {
        projectId: uuidOf(1),
        title: 'My session',
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC,
      });

      expect(result.sessionUuid).toBe('session-uuid');
      expect(result.connectionTicket).toBe('signed.ticket');
      expectSeatOf(result, 1, 'host');
      expect(user.findUnique).toHaveBeenCalledWith({
        where: { id: uuidOf(1) },
        select: { playerNumber: true },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(1)),
      );
    });

    it.each([
      ['a real game', undefined, false],
      ['an editor test', true, true],
    ])('records the room it creates as %s', async (_case, editorTest, recorded) => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockResolvedValueOnce(makeSession({ projectId: uuidOf(3) }));

      await service.create(uuidOf(1), {
        projectId: uuidOf(3),
        title: 'My session',
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC,
        ...(editorTest === undefined ? {} : { editorTest }),
      });

      expect(accounting.roomCreated).toHaveBeenCalledWith('session-uuid', uuidOf(3), recorded);
    });

    it('hands its accounting to the room server as the observer of seats', () => {
      const { mock } = jest.mocked(SyncedGameTableWebRTCServer);

      expect(mock.calls[0]?.[4]).toBe(accounting);
    });

    it('generates a join code for INVITE_CODE sessions', async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create.mockImplementationOnce(({ data }: { data: { joinCode: string } }) =>
        Promise.resolve(
          makeSession({
            visibility: GameSessionVisibility.INVITE_CODE,
            joinCode: data.joinCode,
          }),
        ),
      );

      const result = await service.create(uuidOf(1), {
        projectId: uuidOf(1),
        title: 'Invite',
        maxPlayers: 4,
        visibility: GameSessionVisibility.INVITE_CODE,
      });

      expect(result.joinCode).toBeDefined();
      expect(result.joinCode).toHaveLength(8);
    });

    it('draws another join code when the first one is already taken', async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(null);
      gameSession.create
        .mockRejectedValueOnce(prismaError('P2002'))
        .mockImplementationOnce(({ data }: { data: { joinCode: string } }) =>
          Promise.resolve(
            makeSession({
              visibility: GameSessionVisibility.INVITE_CODE,
              joinCode: data.joinCode,
            }),
          ),
        );

      const result = await service.create(uuidOf(1), {
        projectId: uuidOf(1),
        title: 'Invite',
        maxPlayers: 4,
        visibility: GameSessionVisibility.INVITE_CODE,
      });

      const [taken, drawn] = gameSession.create.mock.calls.map(
        ([arg]) => (arg as { data: { joinCode: string } }).data.joinCode,
      );
      expect(gameSession.create).toHaveBeenCalledTimes(2);
      expect(drawn).not.toBe(taken);
      expect(result.joinCode).toBe(drawn);
    });
  });

  describe('host join policy', () => {
    it('forces INVITE_CODE and mints a join code for a CODE_ONLY host', async () => {
      projectService.findOne.mockResolvedValueOnce(makeProject());
      gameSession.findFirst.mockResolvedValueOnce(null);
      user.findUnique.mockResolvedValueOnce({ sessionJoinPolicy: 'CODE_ONLY' });
      gameSession.create.mockImplementationOnce(
        ({ data }: { data: { joinCode: string; visibility: string } }) =>
          Promise.resolve(
            makeSession({
              visibility: data.visibility as GameSessionVisibility,
              joinCode: data.joinCode,
            }),
          ),
      );

      const result = await service.create(uuidOf(1), {
        projectId: uuidOf(1),
        title: 'x',
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC,
      });

      expect(gameSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.INVITE_CODE,
            joinCode: expect.any(String),
          }),
        }),
      );
      expect(result.joinCode).toHaveLength(8);
    });

    it('raises PUBLIC to FRIENDS_ONLY for a FRIENDS host but keeps a stricter choice', async () => {
      projectService.findOne.mockResolvedValue(makeProject());
      gameSession.findFirst.mockResolvedValue(null);
      user.findUnique.mockResolvedValue({ sessionJoinPolicy: 'FRIENDS' });
      gameSession.create.mockResolvedValue(makeSession());

      await service.create(uuidOf(1), {
        projectId: uuidOf(1),
        title: 'x',
        maxPlayers: 4,
        visibility: GameSessionVisibility.PUBLIC,
      });
      expect(gameSession.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.FRIENDS_ONLY,
          }),
        }),
      );

      gameSession.create.mockImplementationOnce(({ data }: { data: { joinCode: string } }) =>
        Promise.resolve(makeSession({ joinCode: data.joinCode })),
      );
      await service.create(uuidOf(1), {
        projectId: uuidOf(1),
        title: 'x',
        maxPlayers: 4,
        visibility: GameSessionVisibility.INVITE_CODE,
      });
      expect(gameSession.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.INVITE_CODE,
          }),
        }),
      );
    });

    it('applies the floor on update too', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      user.findUnique.mockResolvedValueOnce({ sessionJoinPolicy: 'FRIENDS' });
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update('session-uuid', uuidOf(1), {
        visibility: GameSessionVisibility.PUBLIC,
      });

      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: GameSessionVisibility.FRIENDS_ONLY,
          }),
        }),
      );
    });
  });

  describe('update (join code)', () => {
    it('mints a code when a session without one becomes invite-only', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update('session-uuid', uuidOf(1), {
        visibility: GameSessionVisibility.INVITE_CODE,
      });

      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            joinCode: expect.stringMatching(new RegExp(`^[A-Z2-9]{${JOIN_CODE_LENGTH}}$`)),
          }),
        }),
      );
    });

    it('keeps the code a session was given when it becomes listed', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: 'ABCDEFGH',
        }),
      );
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update('session-uuid', uuidOf(1), {
        visibility: GameSessionVisibility.PUBLIC,
      });

      expect(gameSession.update).toHaveBeenCalledWith({
        where: { sessionId: 'session-uuid' },
        data: { visibility: GameSessionVisibility.PUBLIC },
      });
    });

    it('keeps the same code when a listed session goes back to invite-only', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.PUBLIC,
          joinCode: 'ABCDEFGH',
        }),
      );
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update('session-uuid', uuidOf(1), {
        visibility: GameSessionVisibility.INVITE_CODE,
      });

      expect(gameSession.update).toHaveBeenCalledWith({
        where: { sessionId: 'session-uuid' },
        data: { visibility: GameSessionVisibility.INVITE_CODE },
      });
    });
  });

  describe('update (seats)', () => {
    it('resizes the live room when the host changes the seat count', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      gameSession.update.mockResolvedValueOnce(makeSession({ maxPlayers: 6 }));

      await service.update('session-uuid', uuidOf(1), { maxPlayers: 6 });

      expect(gameTable().server.resizeRoom).toHaveBeenCalledWith('session-uuid', 6);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(1)),
      );
    });

    it('leaves the room alone when the seat count is not part of the update', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.update('session-uuid', uuidOf(1), { title: 'Renamed' });

      expect(gameTable().server.resizeRoom).not.toHaveBeenCalled();
    });
  });

  describe('hostedSession', () => {
    function hosted(visibility: GameSessionVisibility, otherUsers: number): object {
      return {
        sessionId: 'session-uuid',
        projectId: uuidOf(5),
        title: 'Race',
        maxPlayers: 4,
        visibility,
        project: { publishedAt: null, iconUrl: null, name: 'Race' },
        _count: { otherUsers },
      };
    }

    it('counts the host among the players', async () => {
      gameSession.findFirst.mockResolvedValueOnce(hosted(GameSessionVisibility.PUBLIC, 2));

      await expect(service.hostedSession(uuidOf(1))).resolves.toMatchObject({
        players: 3,
        maxPlayers: 4,
      });
    });

    it.each([
      [GameSessionVisibility.PUBLIC, true],
      [GameSessionVisibility.FRIENDS_ONLY, true],
      [GameSessionVisibility.INVITE_CODE, false],
    ])('tells whether a friend may join a %s session without a code', async (visibility, open) => {
      gameSession.findFirst.mockResolvedValueOnce(hosted(visibility, 0));

      await expect(service.hostedSession(uuidOf(1))).resolves.toMatchObject({
        openToFriends: open,
      });
    });

    it('answers null for a user hosting nothing', async () => {
      gameSession.findFirst.mockResolvedValueOnce(null);

      await expect(service.hostedSession(uuidOf(1))).resolves.toBeNull();
    });
  });

  describe('friends-only sessions', () => {
    it("lists FRIENDS_ONLY sessions only to the host's friends", async () => {
      gameSession.findMany.mockResolvedValue([
        makeSession({ hostId: uuidOf(1), visibility: GameSessionVisibility.FRIENDS_ONLY }),
      ]);

      friendsService.friendIdsOf.mockResolvedValueOnce([]);
      await expect(service.list(uuidOf(1), uuidOf(2))).resolves.toHaveLength(0);

      friendsService.friendIdsOf.mockResolvedValueOnce([uuidOf(1)]);
      await expect(service.list(uuidOf(1), uuidOf(2))).resolves.toHaveLength(1);
      expect(friendsService.friendIdsOf).toHaveBeenCalledWith(uuidOf(2));
    });

    it("lists a FRIENDS_ONLY session to a member who is not the host's friend", async () => {
      gameSession.findMany.mockResolvedValueOnce([
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.FRIENDS_ONLY,
          otherUsers: [aPlayer(2)],
        }),
      ]);

      await expect(service.list(uuidOf(1), uuidOf(2))).resolves.toHaveLength(1);
    });

    it("asks for the caller's friends once however many sessions are open", async () => {
      gameSession.findMany.mockResolvedValueOnce([
        makeSession({
          sessionId: 'a',
          hostId: uuidOf(5),
          visibility: GameSessionVisibility.FRIENDS_ONLY,
        }),
        makeSession({
          sessionId: 'b',
          hostId: uuidOf(6),
          visibility: GameSessionVisibility.FRIENDS_ONLY,
        }),
        makeSession({
          sessionId: 'c',
          hostId: uuidOf(7),
          visibility: GameSessionVisibility.FRIENDS_ONLY,
        }),
      ]);
      friendsService.friendIdsOf.mockResolvedValueOnce([uuidOf(5), uuidOf(7)]);

      const sessions = await service.list(undefined, uuidOf(2));

      expect(sessions.map((session) => session.sessionId)).toEqual(['a', 'c']);
      expect(friendsService.friendIdsOf).toHaveBeenCalledTimes(1);
      expect(friendsService.areFriends).not.toHaveBeenCalled();
    });

    it('lets a friend join and blocks a stranger', async () => {
      const session = makeSession({
        hostId: uuidOf(1),
        visibility: GameSessionVisibility.FRIENDS_ONLY,
      });
      gameSession.findFirst.mockResolvedValue(session);
      gameSession.findUnique.mockResolvedValue(session);
      gameSession.update.mockResolvedValue(session);

      friendsService.areFriends.mockResolvedValueOnce(false);
      await expect(service.join('session-uuid', uuidOf(2))).rejects.toBeInstanceOf(
        MultiplayerForbiddenError,
      );

      friendsService.areFriends.mockResolvedValueOnce(true);
      await expect(service.join('session-uuid', uuidOf(2))).resolves.toMatchObject({
        connectionTicket: 'signed.ticket',
      });
    });

    it('lets a friend fetch a FRIENDS_ONLY session', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: uuidOf(1), visibility: GameSessionVisibility.FRIENDS_ONLY }),
      );
      friendsService.areFriends.mockResolvedValueOnce(true);

      await expect(service.get('session-uuid', uuidOf(2))).resolves.toBeDefined();
    });
  });

  describe('join', () => {
    it('rejects an invalid join code on INVITE_CODE sessions', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: 'RIGHTCOD',
        }),
      );

      await expect(service.join('session-uuid', uuidOf(2), 'WRONG')).rejects.toBeInstanceOf(
        MultiplayerInvalidJoinCodeError,
      );
    });

    it('rejects when the session is full', async () => {
      // The session is read once to find it, and again inside the transaction for the capacity check.
      const full = makeSession({
        maxPlayers: 2,
        otherUsers: [aPlayer(5)],
      });
      gameSession.findFirst.mockResolvedValue(full);
      gameSession.findUnique.mockResolvedValue(full);

      await expect(service.join('session-uuid', uuidOf(2))).rejects.toBeInstanceOf(
        MultiplayerSessionFullError,
      );
    });

    it('hands a returning member a fresh connection under their own player number', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          otherUsers: [aPlayer(2)],
        }),
      );

      const result = await service.join('session-uuid', uuidOf(2));

      expectSeatOf(result, 2, 'slave');
      expect($transaction).not.toHaveBeenCalled();
    });

    it('joins a public session and returns a slave ticket', async () => {
      gameSession.findFirst.mockResolvedValue(makeSession());
      gameSession.findUnique.mockResolvedValue(makeSession());
      gameSession.update.mockResolvedValue(makeSession());

      const result = await service.join('session-uuid', uuidOf(2));

      expect(result.connectionTicket).toBe('signed.ticket');
      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { otherUsers: { connect: { id: uuidOf(2) } } },
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(1)),
      );
    });

    it('connects nobody twice when a concurrent join got there first', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValueOnce(makeSession({ otherUsers: [aPlayer(2)] }));

      await expect(service.join('session-uuid', uuidOf(2))).resolves.toMatchObject({
        playerId: playerNumberOf(2),
      });
      expect(gameSession.update).not.toHaveBeenCalled();
    });

    it('reports a session that ended while the join was in flight', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValueOnce(makeSession({ endedAt: new Date() }));

      await expect(service.join('session-uuid', uuidOf(2))).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError,
      );
      expect(gameSession.update).not.toHaveBeenCalled();
    });

    it('retries a join that lost a serialization race', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValue(makeSession());
      gameSession.update.mockResolvedValue(makeSession());
      $transaction
        .mockRejectedValueOnce(prismaError('P2034'))
        .mockRejectedValueOnce(prismaError('P2034'));

      await expect(service.join('session-uuid', uuidOf(2))).resolves.toMatchObject({
        playerId: playerNumberOf(2),
      });
      expect($transaction).toHaveBeenCalledTimes(3);
    });

    it('gives up on a join that keeps losing the race', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      $transaction.mockRejectedValue(prismaError('P2034'));

      await expect(service.join('session-uuid', uuidOf(2))).rejects.toBeInstanceOf(
        MultiplayerInvalidStateError,
      );
      expect($transaction).toHaveBeenCalledTimes(MAX_DB_RETRIES);
    });

    it('does not retry a join that failed for another reason', async () => {
      const failure = prismaError('P2025');
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      $transaction.mockRejectedValue(failure);

      await expect(service.join('session-uuid', uuidOf(2))).rejects.toBe(failure);
      expect($transaction).toHaveBeenCalledTimes(1);
    });

    it('lets the host self-join as a synthetic player when editorTest is set', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      const result = await service.join('session-uuid', uuidOf(1), undefined, true);

      expect(result.connectionTicket).toBe('signed.ticket');
      expect(accounting.editorJoined).toHaveBeenCalledWith('session-uuid');
      expect(gameSession.update).not.toHaveBeenCalled();
      const payload = mintedPayload();
      expect(payload.role).toBe('slave');
      expect(payload.playerNumber).toBeGreaterThan(0);
      expect(payload.playerNumber).not.toBe(playerNumberOf(1));
      expect(payload.userId).toBeNull();
      expect(result.playerId).toBe(payload.playerNumber);
    });

    it('still blocks a self-join without the editorTest flag', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      await expect(service.join('session-uuid', uuidOf(1))).rejects.toBeInstanceOf(
        MultiplayerUserAlreadyJoinedError,
      );
    });

    it('gives a non-host member their own seat, never a synthetic one, when editorTest is set', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: uuidOf(1), otherUsers: [aPlayer(2)] }),
      );

      const result = await service.join('session-uuid', uuidOf(2), undefined, true);

      expectSeatOf(result, 2, 'slave');
    });
  });

  describe('account rows', () => {
    function shown(relation: unknown): string[] {
      expect(relation).toEqual({ select: expect.any(Object) });

      return Object.keys((relation as { select: object }).select).sort();
    }

    it('reads only the public face of the host and the members', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());

      await service.get('session-uuid', uuidOf(1));

      const { include } = gameSession.findFirst.mock.calls[0]![0] as {
        include: { host: unknown; otherUsers: unknown };
      };
      expect(shown(include.host)).toEqual(['id', 'nickname', 'username']);
      expect(shown(include.otherUsers)).toEqual(['id', 'nickname', 'username']);
    });

    it('reads only ids when it re-checks membership inside the join', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession());
      gameSession.findUnique.mockResolvedValueOnce(makeSession());
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.join('session-uuid', uuidOf(2));

      const { include } = gameSession.findUnique.mock.calls[0]![0] as {
        include: { otherUsers: unknown };
      };
      expect(shown(include.otherUsers)).toEqual(['id']);
    });
  });

  describe('host-only actions', () => {
    it('update is forbidden for a non-host', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      await expect(
        service.update('session-uuid', uuidOf(999), { title: 'new' }),
      ).rejects.toBeInstanceOf(MultiplayerForbiddenError);
    });

    it('delete is forbidden for a non-host', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      await expect(service.delete('session-uuid', uuidOf(999))).rejects.toBeInstanceOf(
        MultiplayerForbiddenError,
      );
    });

    it('delete soft-ends the session and closes the room', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      gameSession.updateManyAndReturn.mockResolvedValueOnce([{ hostId: uuidOf(1) }]);

      await service.delete('session-uuid', uuidOf(1));

      expect(gameSession.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'session-uuid', endedAt: null },
        }),
      );
      expect(gameTable().server.closeRoom).toHaveBeenCalledWith('session-uuid');
    });
  });

  describe('get (visibility access control)', () => {
    it('hides a FRIENDS_ONLY session from a non-member (404)', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.FRIENDS_ONLY,
        }),
      );

      await expect(service.get('session-uuid', uuidOf(99))).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError,
      );
    });

    it('hides an INVITE_CODE session from a non-member (404)', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: 'ABCDEFGH',
        }),
      );

      await expect(service.get('session-uuid', uuidOf(99))).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError,
      );
    });

    it('returns an INVITE_CODE session for a non-member who holds its code', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: 'ABCDEFGH',
        }),
      );

      const session = await service.get('session-uuid', uuidOf(99), 'ABCDEFGH');

      expect(session.sessionId).toBe('session-uuid');
    });

    it('hides an INVITE_CODE session from a non-member with another code (404)', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: 'ABCDEFGH',
        }),
      );

      await expect(service.get('session-uuid', uuidOf(99), 'ZZZZZZZZ')).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError,
      );
    });

    it('returns a non-public session for one of its members', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.FRIENDS_ONLY,
          otherUsers: [aPlayer(2)],
        }),
      );

      const session = await service.get('session-uuid', uuidOf(2));

      expect(session.sessionId).toBe('session-uuid');
    });

    it('returns a PUBLIC session for a non-member', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: uuidOf(1), visibility: GameSessionVisibility.PUBLIC }),
      );

      const session = await service.get('session-uuid', uuidOf(99));

      expect(session.sessionId).toBe('session-uuid');
    });
  });

  describe('roster', () => {
    it('names the host first, then everyone who joined', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          host: { id: uuidOf(1), username: 'alice', nickname: 'Ali' },
          otherUsers: [
            { id: uuidOf(2), username: 'bob', nickname: null },
            { id: uuidOf(3), username: 'cleo', nickname: 'Cle' },
          ],
        }),
      );

      await expect(service.roster('session-uuid', uuidOf(2))).resolves.toEqual({
        players: [
          { userId: uuidOf(1), username: 'alice', nickname: 'Ali', host: true },
          { userId: uuidOf(2), username: 'bob', nickname: null, host: false },
          { userId: uuidOf(3), username: 'cleo', nickname: 'Cle', host: false },
        ],
        maxPlayers: 4,
      });
    });

    it('does not leak the roster of a session the caller cannot discover', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: 'ABCDEFGH',
        }),
      );

      await expect(service.roster('session-uuid', uuidOf(99))).rejects.toBeInstanceOf(
        MultiplayerGameSessionNotFoundError,
      );
    });
  });

  describe('invite', () => {
    const inviteOnly = (): GameSessionEx =>
      makeSession({
        hostId: uuidOf(1),
        projectId: uuidOf(9),
        visibility: GameSessionVisibility.INVITE_CODE,
        joinCode: 'ABCDEFGH',
      });

    it('notifies a friend with the code that gets them in', async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      friendsService.areFriends.mockResolvedValueOnce(true);

      await service.invite('session-uuid', uuidOf(1), uuidOf(42));

      expect(friendsService.areFriends).toHaveBeenCalledWith(uuidOf(1), uuidOf(42));
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuidOf(42),
          data: expect.objectContaining({
            sessionId: 'session-uuid',
            joinCode: 'ABCDEFGH',
          }),
        }),
      );
    });

    it('notifies someone who works on the game without being a friend', async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      project.count.mockResolvedValueOnce(1);

      await service.invite('session-uuid', uuidOf(1), uuidOf(42));

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(42) }),
      );
    });

    it('refuses to notify someone the host has no tie to', async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());

      await expect(service.invite('session-uuid', uuidOf(1), uuidOf(42))).rejects.toBeInstanceOf(
        MultiplayerForbiddenError,
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('reports an invitee that does not exist', async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      user.findUnique.mockResolvedValueOnce(null);
      friendsService.areFriends.mockResolvedValueOnce(true);

      await expect(service.invite('session-uuid', uuidOf(1), uuidOf(42))).rejects.toBeInstanceOf(
        MultiplayerUserNotFoundError,
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('reports an invitee whose account was deleted', async () => {
      gameSession.findFirst.mockResolvedValueOnce(inviteOnly());
      user.findUnique.mockResolvedValueOnce({ deletedAt: new Date() });
      friendsService.areFriends.mockResolvedValueOnce(true);

      await expect(service.invite('session-uuid', uuidOf(1), uuidOf(42))).rejects.toBeInstanceOf(
        MultiplayerUserNotFoundError,
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('names the game as the hub shows it, not by its working name', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          project: { ...makeSession().project, name: 'snake-wip', publishedName: 'Snake' },
        }),
      );
      friendsService.areFriends.mockResolvedValueOnce(true);

      await service.invite('session-uuid', uuidOf(1), uuidOf(42));

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'alice invited you to play Snake' }),
      );
    });

    it('refuses an invite from anyone but the host', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      await expect(service.invite('session-uuid', uuidOf(99), uuidOf(42))).rejects.toBeInstanceOf(
        MultiplayerForbiddenError,
      );
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns PUBLIC sessions but omits FRIENDS_ONLY and INVITE_CODE', async () => {
      gameSession.findMany.mockResolvedValueOnce([
        makeSession({
          sessionId: 'public-uuid',
          visibility: GameSessionVisibility.PUBLIC,
        }),
        makeSession({
          sessionId: 'friends-uuid',
          visibility: GameSessionVisibility.FRIENDS_ONLY,
        }),
        makeSession({
          sessionId: 'invite-uuid',
          visibility: GameSessionVisibility.INVITE_CODE,
          joinCode: 'ABCDEFGH',
        }),
      ]);

      const sessions = await service.list(uuidOf(1), uuidOf(99));

      expect(sessions.map((session) => session.sessionId)).toEqual(['public-uuid']);
    });

    it('asks about every game on the hub when no project is named', async () => {
      gameSession.findMany.mockResolvedValueOnce([]);

      await service.list(undefined, uuidOf(99));

      expect(gameSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endedAt: null, project: { publishedAt: { not: null }, hiddenAt: null } },
        }),
      );
    });

    it("lists one game's sessions as they are, the latest first, tests of its editor included", async () => {
      gameSession.findMany.mockResolvedValue([makeSession()]);

      await expect(service.list(uuidOf(7), uuidOf(2))).resolves.toHaveLength(1);

      expect(gameSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endedAt: null, projectId: uuidOf(7), project: { hiddenAt: null } },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(accounting.editorTests).not.toHaveBeenCalled();
    });

    it('leaves the rooms an editor opened to test out of a listing across games', async () => {
      gameSession.findMany.mockResolvedValue([
        makeSession({ sessionId: 'played' }),
        makeSession({ sessionId: 'tested' }),
      ]);
      accounting.editorTests.mockResolvedValue(new Set(['tested']));

      const sessions = await service.list(undefined, uuidOf(2));

      expect(sessions.map((session) => session.sessionId)).toEqual(['played']);
      expect(accounting.editorTests).toHaveBeenCalledWith(['played', 'tested']);
    });

    it('caps a listing across games, after leaving out what the caller may not see', async () => {
      gameSession.findMany.mockResolvedValue([
        makeSession({ sessionId: 'hidden', visibility: GameSessionVisibility.INVITE_CODE }),
        ...Array.from({ length: SESSION_LIST_MAX + 5 }, (_, index) =>
          makeSession({ sessionId: `open-${index}` }),
        ),
      ]);

      const sessions = await service.list(undefined, uuidOf(2));

      expect(sessions).toHaveLength(SESSION_LIST_MAX);
      expect(sessions[0]?.sessionId).toBe('open-0');
    });

    it('reads how a session is drawn from the row of its game', () => {
      const session = makeSession();
      const look = {
        coverUrl: 'https://cdn.test/projects/1/image',
        clipUrl: null,
        disk: { color: '#ff8426', finish: 'solid' },
      };
      projectService.lookOf.mockReturnValue(look);

      expect(service.lookOf(session)).toBe(look);
      expect(projectService.lookOf).toHaveBeenCalledWith(session.project);
    });

    it("matches a term against the room's name and both names of the game", async () => {
      gameSession.findMany.mockResolvedValueOnce([]);

      await service.list(undefined, uuidOf(99), ' arena ');

      expect(gameSession.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: 'arena', mode: 'insensitive' } },
              { project: { publishedName: { contains: 'arena', mode: 'insensitive' } } },
              { project: { name: { contains: 'arena', mode: 'insensitive' } } },
            ],
          }),
        }),
      );
    });
  });

  describe('joinByCode', () => {
    it('rejects an unknown code', async () => {
      gameSession.findFirst.mockResolvedValueOnce(null);

      await expect(service.joinByCode('NOPE', uuidOf(2))).rejects.toBeInstanceOf(
        MultiplayerInvalidJoinCodeError,
      );
    });

    it('resolves the session by code and joins it', async () => {
      const invite = makeSession({
        visibility: GameSessionVisibility.INVITE_CODE,
        joinCode: 'ABCDEFGH',
      });
      gameSession.findFirst.mockResolvedValue(invite);
      gameSession.findUnique.mockResolvedValue(invite);
      gameSession.update.mockResolvedValue(makeSession());

      const result = await service.joinByCode('ABCDEFGH', uuidOf(2));

      expect(result.connectionTicket).toBe('signed.ticket');
      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { otherUsers: { connect: { id: uuidOf(2) } } },
        }),
      );
    });

    it('still gets a player in by the code once the session is listed', async () => {
      const listed = makeSession({
        visibility: GameSessionVisibility.PUBLIC,
        joinCode: 'ABCDEFGH',
      });
      gameSession.findFirst.mockResolvedValue(listed);
      gameSession.findUnique.mockResolvedValue(listed);
      gameSession.update.mockResolvedValue(listed);

      await expect(service.joinByCode('ABCDEFGH', uuidOf(2))).resolves.toMatchObject({
        playerId: playerNumberOf(2),
      });
    });
  });

  describe('refreshTicket', () => {
    it('mints a fresh ticket for a joined slave', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: uuidOf(1), otherUsers: [aPlayer(2)] }),
      );

      const result = await service.refreshTicket('session-uuid', uuidOf(2));

      expectSeatOf(result, 2, 'slave');
    });

    it('rejects a non-member', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      await expect(service.refreshTicket('session-uuid', uuidOf(99))).rejects.toBeInstanceOf(
        MultiplayerUserNotInSessionError,
      );
    });

    // A ticket is minted for a connection: the editor's test rig plays under a
    // synthetic player number its ticket alone remembers, with no account behind it.
    const RIG_TICKET = {
      kind: SYNCED_GAME_TABLE_TICKET_KIND,
      sessionId: 'session-uuid',
      playerNumber: 123456789,
      userId: null,
      role: 'slave',
      maxPlayers: 4,
    };

    it("keeps the rig client's synthetic number and slave role when it presents its ticket", async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      jwtService.verify.mockReturnValueOnce(RIG_TICKET);

      const result = await service.refreshTicket('session-uuid', uuidOf(1), 'old.ticket');

      expect(jwtService.verify).toHaveBeenCalledWith('old.ticket', {
        ignoreExpiration: true,
      });
      expect(result.playerId).toBe(123456789);
      expect(mintedPayload()).toMatchObject({
        playerNumber: 123456789,
        userId: null,
        role: 'slave',
      });
    });

    it("does not hand the host a member's seat for presenting the member's ticket", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: uuidOf(1), otherUsers: [aPlayer(2)] }),
      );
      jwtService.verify.mockReturnValueOnce({
        ...RIG_TICKET,
        playerNumber: playerNumberOf(2),
        userId: uuidOf(2),
      });

      const result = await service.refreshTicket('session-uuid', uuidOf(1), 'member.ticket');

      expectSeatOf(result, 1, 'host');
    });

    it('mints from the account when no ticket is given', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      const result = await service.refreshTicket('session-uuid', uuidOf(1));

      expect(jwtService.verify).not.toHaveBeenCalled();
      expectSeatOf(result, 1, 'host');
    });

    it('ignores a ticket minted for another session', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      jwtService.verify.mockReturnValueOnce({
        ...RIG_TICKET,
        sessionId: 'other-session',
      });

      const result = await service.refreshTicket('session-uuid', uuidOf(1), 'old.ticket');

      expectSeatOf(result, 1, 'host');
    });

    it('ignores a ticket it cannot verify', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      jwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid signature');
      });

      const result = await service.refreshTicket('session-uuid', uuidOf(1), 'forged');

      expectSeatOf(result, 1, 'host');
    });

    it("does not hand a member the host's seat for presenting the host's ticket", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: uuidOf(1), otherUsers: [aPlayer(2)] }),
      );
      jwtService.verify.mockReturnValueOnce({
        ...RIG_TICKET,
        playerNumber: playerNumberOf(1),
        userId: uuidOf(1),
        role: 'host',
      });

      const result = await service.refreshTicket('session-uuid', uuidOf(2), 'host.ticket');

      expectSeatOf(result, 2, 'slave');
    });

    it("does not hand a member another member's seat", async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({
          hostId: uuidOf(1),
          otherUsers: [aPlayer(2), aPlayer(3)],
        }),
      );
      jwtService.verify.mockReturnValueOnce({
        ...RIG_TICKET,
        playerNumber: playerNumberOf(3),
        userId: uuidOf(3),
      });

      const result = await service.refreshTicket('session-uuid', uuidOf(2), 'other.ticket');

      expectSeatOf(result, 2, 'slave');
    });

    it('still rejects a non-member holding a ticket', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));
      jwtService.verify.mockReturnValueOnce(RIG_TICKET);

      await expect(
        service.refreshTicket('session-uuid', uuidOf(99), 'old.ticket'),
      ).rejects.toBeInstanceOf(MultiplayerUserNotInSessionError);
    });
  });

  describe('endSession', () => {
    it('soft-ends an active session', async () => {
      gameSession.updateManyAndReturn.mockResolvedValueOnce([{ hostId: uuidOf(4) }]);

      await service.endSession('session-uuid');

      expect(gameSession.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'session-uuid', endedAt: null },
        }),
      );
      expect(accounting.sessionEnded).toHaveBeenCalledWith('session-uuid');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(4)),
      );
    });

    it('tells nobody about a session that had already ended', async () => {
      gameSession.updateManyAndReturn.mockResolvedValueOnce([]);

      await service.endSession('session-uuid');

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('logs a failure instead of throwing it', async () => {
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      gameSession.updateManyAndReturn.mockRejectedValueOnce(new Error('database is gone'));

      await expect(service.endSession('session-uuid')).resolves.toBeUndefined();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('database is gone'));

      logged.mockRestore();
    });
  });

  describe('removeAccount', () => {
    it('ends what the account hosts and gives up its seats elsewhere', async () => {
      gameSession.findMany
        .mockResolvedValueOnce([{ sessionId: 'hosted-uuid' }])
        .mockResolvedValueOnce([{ sessionId: 'joined-uuid', hostId: uuidOf(9) }]);
      gameSession.updateManyAndReturn.mockResolvedValueOnce([{ hostId: uuidOf(4) }]);

      await service.removeAccount(uuidOf(4));

      expect(gameSession.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: 'hosted-uuid', endedAt: null } }),
      );
      expect(gameTable().server.closeRoom).toHaveBeenCalledWith('hosted-uuid');
      expect(gameSession.update).toHaveBeenCalledWith({
        where: { sessionId: 'joined-uuid' },
        data: { otherUsers: { disconnect: { id: uuidOf(4) } } },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(9)),
      );
    });

    it('does nothing for an account in no session', async () => {
      gameSession.findMany.mockResolvedValue([]);

      await service.removeAccount(uuidOf(4));

      expect(gameSession.update).not.toHaveBeenCalled();
      expect(gameTable().server.closeRoom).not.toHaveBeenCalled();
    });
  });

  describe('reapStaleSessions', () => {
    it('soft-ends orphaned sessions left active past the max lifetime', async () => {
      jest.spyOn(service, 'connectedPlayerCount').mockReturnValue(0);
      gameSession.findMany.mockResolvedValueOnce([
        { sessionId: 'stale-1', hostId: uuidOf(1) },
        { sessionId: 'stale-2', hostId: uuidOf(2) },
      ]);
      gameSession.updateMany.mockResolvedValueOnce({ count: 2 });

      await service.reapStaleSessions();

      expect(gameSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endedAt: null, startedAt: { lt: expect.any(Date) } },
        }),
      );
      expect(gameSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: { in: ['stale-1', 'stale-2'] } },
        }),
      );
      expect(gameTable().server.closeRoom).toHaveBeenCalledWith('stale-1');
      expect(gameTable().server.closeRoom).toHaveBeenCalledWith('stale-2');
      expect(accounting.sessionEnded).toHaveBeenCalledWith('stale-1');
      expect(accounting.sessionEnded).toHaveBeenCalledWith('stale-2');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(1)),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(2)),
      );
    });

    it('leaves a still-live long-running session untouched', async () => {
      jest
        .spyOn(service, 'connectedPlayerCount')
        .mockImplementation((sessionId) => (sessionId === 'live' ? 3 : 0));
      gameSession.findMany.mockResolvedValueOnce([{ sessionId: 'live', hostId: uuidOf(1) }]);

      await service.reapStaleSessions();

      expect(gameSession.updateMany).not.toHaveBeenCalled();
      expect(gameTable().server.closeRoom).not.toHaveBeenCalled();
    });
  });

  describe('game-table server', () => {
    it('ends the session when the server reports its host gone', () => {
      gameSession.updateManyAndReturn.mockResolvedValueOnce([{ hostId: uuidOf(1) }]);
      gameTable().onHostDisconnected('session-uuid');

      expect(gameSession.updateManyAndReturn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'session-uuid', endedAt: null },
        }),
      );
    });

    it('is given a verifier that reads the seat a ticket was minted for', () => {
      const seat = {
        sessionId: 'session-uuid',
        playerNumber: playerNumberOf(2),
        userId: uuidOf(2),
        role: 'slave',
        maxPlayers: 4,
      };
      jwtService.verify.mockReturnValueOnce({ kind: SYNCED_GAME_TABLE_TICKET_KIND, ...seat });
      expect(gameTable().verifyTicket('signed.ticket')).toEqual(seat);
    });

    it.each([
      ['no player number', { userId: uuidOf(2) }],
      ['a player number that is not an integer', { playerNumber: 2.5, userId: uuidOf(2) }],
      ['an account id for a player number', { playerNumber: uuidOf(2), userId: uuidOf(2) }],
      ['a number for an account', { playerNumber: playerNumberOf(2), userId: 2 }],
      ['no word on the account', { playerNumber: playerNumberOf(2) }],
    ])('is given a verifier that refuses a ticket with %s', (_case, seat) => {
      jwtService.verify.mockReturnValueOnce({
        kind: SYNCED_GAME_TABLE_TICKET_KIND,
        sessionId: 'session-uuid',
        role: 'slave',
        maxPlayers: 4,
        ...seat,
      });
      expect(() => gameTable().verifyTicket('signed.ticket')).toThrow(MultiplayerInvalidStateError);
    });

    it('is given a verifier that refuses a token signed for something else', () => {
      jwtService.verify.mockReturnValueOnce({ sub: uuidOf(1), email: 'alice@example.org' });
      expect(() => gameTable().verifyTicket('access.token')).toThrow(MultiplayerInvalidStateError);
    });
  });

  describe('leave', () => {
    it('rejects the host trying to leave', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      await expect(service.leave('session-uuid', uuidOf(1))).rejects.toBeInstanceOf(
        MultiplayerUserNotInSessionError,
      );
    });

    it('rejects a non-member trying to leave', async () => {
      gameSession.findFirst.mockResolvedValueOnce(makeSession({ hostId: uuidOf(1) }));

      await expect(service.leave('session-uuid', uuidOf(99))).rejects.toBeInstanceOf(
        MultiplayerUserNotInSessionError,
      );
    });

    it('disconnects a member from the session', async () => {
      gameSession.findFirst.mockResolvedValueOnce(
        makeSession({ hostId: uuidOf(1), otherUsers: [aPlayer(2)] }),
      );
      gameSession.update.mockResolvedValueOnce(makeSession());

      await service.leave('session-uuid', uuidOf(2));

      expect(gameSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 'session-uuid' },
          data: { otherUsers: { disconnect: { id: uuidOf(2) } } },
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        ACTIVITY_CHANGED,
        new ActivityChangedEvent(uuidOf(1)),
      );
    });
  });
});
