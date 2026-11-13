import { NotFoundException } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';

import {
  ACTIVITY_CHANGED,
  ActivityChangedEvent,
  FRIENDSHIP_CHANGED,
  FriendshipChangedEvent,
  PROJECT_CHANGED,
  ProjectChangedEvent,
} from '../common/domain-events';
import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from '../routes/friends/friends.service';
import { HostedSession, MultiplayerService } from '../routes/multiplayer/multiplayer.service';
import {
  PRESENCE_RESYNC_AFTER_MS,
  PRESENCE_RESYNC_CONCURRENCY,
  PRESENCE_RESYNC_MAX_BATCH,
  PRESENCE_RESYNC_MIN_BATCH,
  presenceResyncBatch,
  PresenceService,
} from './presence.service';

function aHostedSession(overrides: Partial<HostedSession> = {}): HostedSession {
  return {
    sessionId: 'uuid',
    projectId: 5,
    title: 'Race',
    maxPlayers: 4,
    players: 1,
    openToFriends: true,
    project: { publishedAt: null, iconUrl: null, name: 'Race' },
    ...overrides,
  };
}

describe('PresenceService', () => {
  let service: PresenceService;
  const multiplayerService = { hostedSession: jest.fn() };
  const workSession = { findFirst: jest.fn() };
  const user = { findUnique: jest.fn() };
  const project = { findFirst: jest.fn() };
  const friendsService = { friendIdsOf: jest.fn(), areFriends: jest.fn() };
  const fanOut = jest.fn();

  beforeEach(async () => {
    jest.resetAllMocks();
    multiplayerService.hostedSession.mockResolvedValue(null);
    workSession.findFirst.mockResolvedValue(null);
    user.findUnique.mockResolvedValue({ username: 'louis', nickname: null });
    project.findFirst.mockResolvedValue(null);
    friendsService.friendIdsOf.mockResolvedValue([]);
    friendsService.areFriends.mockResolvedValue(false);

    const module = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: PrismaService, useValue: { workSession, user, project } },
        { provide: FriendsService, useValue: friendsService },
        { provide: MultiplayerService, useValue: multiplayerService },
      ],
    }).compile();

    service = module.get(PresenceService);
    service.setFanOut(fanOut);
  });

  it('counts the accounts online in each state, each account once', async () => {
    project.findFirst.mockResolvedValue({ id: 42, name: 'Game', publishedName: 'Game' });
    await service.onSocketOpen(1, 11);
    await service.onSocketOpen(1, 12);
    await service.onSocketOpen(2, 21);
    await service.onSet(2, 21, { kind: 'PLAYING', releaseId: 42 });

    expect(service.countsByKind()).toEqual({ IDLE: 1, PLAYING: 1, BUILDING: 0, HOSTING: 0 });

    await service.onSocketClose(1, 11);
    await service.onSocketClose(1, 12);
    expect(service.countsByKind()).toEqual({ IDLE: 0, PLAYING: 1, BUILDING: 0, HOSTING: 0 });
  });

  it('comes online IDLE on first socket and offline when the last one closes', async () => {
    await service.onSocketOpen(1, 11);
    expect(service.get(1)).toMatchObject({ userId: 1, kind: 'IDLE' });

    await service.onSocketOpen(1, 12);
    await service.onSocketClose(1, 12);
    expect(service.get(1)).not.toBeNull();

    await service.onSocketClose(1, 11);
    expect(service.get(1)).toBeNull();
  });

  it('counts both sockets of a user whose two tabs open together', async () => {
    await Promise.all([service.onSocketOpen(1, 11), service.onSocketOpen(1, 12)]);

    await service.onSocketClose(1, 11);
    expect(service.get(1)).not.toBeNull();

    await service.onSocketClose(1, 12);
    expect(service.get(1)).toBeNull();
  });

  it('leaves nobody online when a socket closes while its open is still deriving', async () => {
    friendsService.friendIdsOf.mockImplementation(async (id: number) => (id === 1 ? [2] : [1]));
    await service.onSocketOpen(2, 21);
    fanOut.mockClear();

    const opening = service.onSocketOpen(1, 11);
    await service.onSocketClose(1, 11);
    await opening;

    expect(service.get(1)).toBeNull();
    expect(fanOut).not.toHaveBeenCalledWith(
      2,
      expect.objectContaining({ type: 'presence:changed' }),
    );
  });

  it("keeps an activity declared while the socket's open is still deriving", async () => {
    const opening = service.onSocketOpen(1, 11);
    await service.onSet(1, 11, { kind: 'PLAYING', releaseId: 42 });
    await opening;

    expect(service.get(1)).toMatchObject({ kind: 'PLAYING', releaseId: 42 });
  });

  it('still counts a socket whose derivation failed', async () => {
    user.findUnique.mockRejectedValueOnce(new Error('database down'));
    await expect(service.onSocketOpen(1, 11)).rejects.toThrow('database down');

    await service.onSocketOpen(1, 12);
    await service.onSocketClose(1, 12);
    await service.onSet(1, 11, { kind: 'IDLE' });

    expect(service.get(1)).toMatchObject({ kind: 'IDLE' });
  });

  it('fans changes out to online friends only', async () => {
    // 1 and 2 are friends; 2 is online, 3 is a friend but offline.
    friendsService.friendIdsOf.mockImplementation(async (id: number) => (id === 1 ? [2, 3] : [1]));
    await service.onSocketOpen(2, 21);
    fanOut.mockClear();

    await service.onSocketOpen(1, 11);
    expect(fanOut).toHaveBeenCalledTimes(1);
    expect(fanOut).toHaveBeenCalledWith(2, {
      type: 'presence:changed',
      payload: expect.objectContaining({ userId: 1, kind: 'IDLE' }),
    });

    fanOut.mockClear();
    await service.onSocketClose(1, 11);
    expect(fanOut).toHaveBeenCalledWith(2, {
      type: 'presence:offline',
      payload: { userId: 1 },
    });
  });

  it('accepts PLAYING from the client but never HOSTING/BUILDING claims', async () => {
    await service.onSocketOpen(1, 11);

    await service.onSet(1, 11, { kind: 'PLAYING', releaseId: 42 });
    expect(service.get(1)).toMatchObject({ kind: 'PLAYING', releaseId: 42 });

    await service.onSet(1, 11, { kind: 'HOSTING' });
    expect(service.get(1)).toMatchObject({ kind: 'IDLE', sessionId: null });
  });

  it('derives HOSTING from a live hosted game session', async () => {
    multiplayerService.hostedSession.mockResolvedValue(
      aHostedSession({
        players: 3,
        project: { publishedAt: new Date(), iconUrl: null, name: 'Race' },
      }),
    );

    await service.onSocketOpen(1, 11);

    expect(multiplayerService.hostedSession).toHaveBeenCalledWith(1);
    expect(service.get(1)).toMatchObject({
      kind: 'HOSTING',
      sessionId: 'uuid',
      projectId: 5,
      releaseId: 5,
      title: 'Race',
      players: 3,
      maxPlayers: 4,
      joinable: true,
    });
  });

  it('shows a hosted session as joinable only when a friend may join it without a code', async () => {
    multiplayerService.hostedSession.mockResolvedValue(aHostedSession({ openToFriends: false }));

    await service.onSocketOpen(1, 11);

    expect(service.get(1)?.joinable).toBe(false);
  });

  it('derives BUILDING from a work session', async () => {
    workSession.findFirst.mockResolvedValue({
      projectId: 7,
      project: { name: 'Platformer', iconUrl: null, _count: { collaborators: 1 } },
    });

    await service.onSocketOpen(1, 11);

    expect(service.get(1)).toMatchObject({
      kind: 'BUILDING',
      projectId: 7,
      title: 'Platformer',
    });
  });

  it('keeps `since` when the activity does not change', async () => {
    await service.onSocketOpen(1, 11);
    const since = service.get(1)!.since;

    await service.onSet(1, 11, { kind: 'IDLE' });
    expect(service.get(1)!.since).toBe(since);
  });

  it('returns the presence of online friends for the snapshot', async () => {
    await service.onSocketOpen(2, 21);
    friendsService.friendIdsOf.mockResolvedValue([2, 3]);

    const snapshot = await service.friendsPresence(1);

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ userId: 2 });
  });

  it("shows a user's presence to that user and to friends, and to nobody else", async () => {
    await service.onSocketOpen(1, 11);

    await expect(service.presenceOf(1, 1)).resolves.toMatchObject({ userId: 1 });
    await expect(service.presenceOf(9, 1)).rejects.toBeInstanceOf(NotFoundException);

    friendsService.areFriends.mockResolvedValue(true);
    await expect(service.presenceOf(9, 1)).resolves.toMatchObject({ userId: 1 });
  });

  it('shows BUILDING once the work session declared before it is joined', async () => {
    await service.onSocketOpen(1, 11);
    expect(service.get(1)).toMatchObject({ kind: 'IDLE' });

    workSession.findFirst.mockResolvedValue({
      projectId: 7,
      project: { name: 'Platformer', iconUrl: null, _count: { collaborators: 0 } },
    });
    await service.onActivityChanged(new ActivityChangedEvent(1));

    expect(service.get(1)).toMatchObject({ kind: 'BUILDING', projectId: 7 });
  });

  it('shows what the client declared once the work session holding it is left', async () => {
    workSession.findFirst.mockResolvedValue({
      projectId: 7,
      project: { name: 'Platformer', iconUrl: null, _count: { collaborators: 0 } },
    });
    project.findFirst.mockResolvedValue({ publishedName: 'Race', name: 'Race', iconUrl: null });
    await service.onSocketOpen(1, 11);
    await service.onSet(1, 11, { kind: 'PLAYING', releaseId: 42 });
    expect(service.get(1)).toMatchObject({ kind: 'BUILDING' });

    workSession.findFirst.mockResolvedValue(null);
    await service.onActivityChanged(new ActivityChangedEvent(1));

    expect(service.get(1)).toMatchObject({ kind: 'PLAYING', releaseId: 42 });
  });

  it('keeps the latest derivation when an earlier one finishes after it', async () => {
    await service.onSocketOpen(1, 11);
    let finishSlow: (value: unknown) => void = () => undefined;
    workSession.findFirst
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishSlow = resolve;
          }),
      )
      .mockResolvedValueOnce(null);

    const slow = service.onActivityChanged(new ActivityChangedEvent(1));
    await service.onActivityChanged(new ActivityChangedEvent(1));
    finishSlow({
      projectId: 7,
      project: { name: 'Platformer', iconUrl: null, _count: { collaborators: 0 } },
    });
    await slow;

    expect(service.get(1)).toMatchObject({ kind: 'IDLE' });
  });

  it('derives nothing for a user who is offline', async () => {
    await service.onActivityChanged(new ActivityChangedEvent(9));

    expect(service.get(9)).toBeNull();
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it("hands two new friends each other's presence", async () => {
    await service.onSocketOpen(1, 11);
    await service.onSocketOpen(2, 21);
    friendsService.areFriends.mockResolvedValue(true);
    fanOut.mockClear();

    await service.onFriendshipChanged(new FriendshipChangedEvent(1, 2));

    expect(fanOut).toHaveBeenCalledWith(1, {
      type: 'presence:changed',
      payload: expect.objectContaining({ userId: 2 }),
    });
    expect(fanOut).toHaveBeenCalledWith(2, {
      type: 'presence:changed',
      payload: expect.objectContaining({ userId: 1 }),
    });
  });

  it("takes two former friends off each other's list", async () => {
    await service.onSocketOpen(1, 11);
    await service.onSocketOpen(2, 21);
    fanOut.mockClear();

    await service.onFriendshipChanged(new FriendshipChangedEvent(1, 2));

    expect(fanOut).toHaveBeenCalledWith(1, { type: 'presence:offline', payload: { userId: 2 } });
    expect(fanOut).toHaveBeenCalledWith(2, { type: 'presence:offline', payload: { userId: 1 } });
  });

  it('shows a new friend who is offline as offline', async () => {
    await service.onSocketOpen(1, 11);
    friendsService.areFriends.mockResolvedValue(true);
    fanOut.mockClear();

    await service.onFriendshipChanged(new FriendshipChangedEvent(1, 2));

    expect(fanOut).toHaveBeenCalledWith(1, { type: 'presence:offline', payload: { userId: 2 } });
  });

  it('shows a game played in one tab while another tab browses or builds', async () => {
    project.findFirst.mockResolvedValue({ publishedName: 'Race', name: 'Race', iconUrl: null });
    await service.onSocketOpen(1, 11);
    await service.onSocketOpen(1, 12);
    await service.onSet(1, 11, { kind: 'PLAYING', releaseId: 42 });

    await service.onSet(1, 12, { kind: 'IDLE' });
    expect(service.get(1)).toMatchObject({ kind: 'PLAYING', releaseId: 42 });

    await service.onSet(1, 12, { kind: 'BUILDING', projectId: 7 });
    expect(service.get(1)).toMatchObject({ kind: 'PLAYING', releaseId: 42 });
  });

  it('shows the game of the tab that declared it last', async () => {
    project.findFirst.mockResolvedValue({ publishedName: 'Race', name: 'Race', iconUrl: null });
    await service.onSocketOpen(1, 11);
    await service.onSocketOpen(1, 12);
    await service.onSet(1, 11, { kind: 'PLAYING', releaseId: 42 });
    await service.onSet(1, 12, { kind: 'PLAYING', releaseId: 43 });
    expect(service.get(1)).toMatchObject({ releaseId: 43 });

    await service.onSet(1, 12, { kind: 'IDLE' });
    expect(service.get(1)).toMatchObject({ releaseId: 42 });
  });

  it('drops the game of a tab closed without saying so', async () => {
    project.findFirst.mockResolvedValue({ publishedName: 'Race', name: 'Race', iconUrl: null });
    await service.onSocketOpen(1, 11);
    await service.onSocketOpen(1, 12);
    await service.onSet(1, 12, { kind: 'PLAYING', releaseId: 42 });

    await service.onSocketClose(1, 12);

    expect(service.get(1)).toMatchObject({ kind: 'IDLE' });
  });

  it('ignores a declaration from a socket it never opened', async () => {
    await service.onSocketOpen(1, 11);

    await service.onSet(1, 99, { kind: 'PLAYING', releaseId: 42 });

    expect(service.get(1)).toMatchObject({ kind: 'IDLE' });
  });

  it('refreshes whoever shows a project when that project changes', async () => {
    workSession.findFirst.mockResolvedValue({
      projectId: 7,
      project: { name: 'Platformer', iconUrl: null, _count: { collaborators: 0 } },
    });
    await service.onSocketOpen(1, 11);
    workSession.findFirst.mockResolvedValue(null);
    await service.onSocketOpen(2, 21);

    workSession.findFirst.mockResolvedValue({
      projectId: 7,
      project: { name: 'Jumper', iconUrl: 'cover.png', _count: { collaborators: 0 } },
    });
    user.findUnique.mockClear();
    await service.onProjectChanged(new ProjectChangedEvent(7));

    expect(service.get(1)).toMatchObject({ title: 'Jumper', coverUrl: 'cover.png' });
    expect(user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('tells friends nothing when a refresh finds what they already have', async () => {
    friendsService.friendIdsOf.mockImplementation(async (id: number) => (id === 1 ? [2] : [1]));
    await service.onSocketOpen(2, 21);
    await service.onSocketOpen(1, 11);
    fanOut.mockClear();

    await service.onSet(1, 11, { kind: 'IDLE' });
    await service.onActivityChanged(new ActivityChangedEvent(1));

    expect(fanOut).not.toHaveBeenCalled();
  });

  it('tells friends when only a detail of the same activity changes', async () => {
    friendsService.friendIdsOf.mockImplementation(async (id: number) => (id === 1 ? [2] : [1]));
    multiplayerService.hostedSession.mockResolvedValue(aHostedSession({ players: 1 }));
    await service.onSocketOpen(2, 21);
    await service.onSocketOpen(1, 11);
    fanOut.mockClear();

    multiplayerService.hostedSession.mockResolvedValue(aHostedSession({ players: 2 }));
    await service.onActivityChanged(new ActivityChangedEvent(1));

    expect(fanOut).toHaveBeenCalledWith(2, {
      type: 'presence:changed',
      payload: expect.objectContaining({ userId: 1, players: 2 }),
    });
  });

  describe('resync', () => {
    let now: jest.SpyInstance<number, []>;

    beforeEach(() => {
      now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    });

    afterEach(() => {
      now.mockRestore();
    });

    it('re-derives only the users nobody refreshed for the resync delay, oldest first', async () => {
      await service.onSocketOpen(2, 21);
      now.mockReturnValue(1_000_500);
      await service.onSocketOpen(1, 11);
      now.mockReturnValue(1_060_000);
      await service.onSocketOpen(3, 31);
      user.findUnique.mockClear();

      now.mockReturnValue(1_000_500 + PRESENCE_RESYNC_AFTER_MS);
      await service.resyncStale();

      expect(user.findUnique.mock.calls.map(([query]) => query.where.id)).toEqual([2, 1]);
    });

    it('re-derives at most one batch per tick', async () => {
      for (let id = 1; id <= PRESENCE_RESYNC_MIN_BATCH + 1; id++) {
        await service.onSocketOpen(id, id);
      }
      user.findUnique.mockClear();

      now.mockReturnValue(1_000_000 + PRESENCE_RESYNC_AFTER_MS);
      await service.resyncStale();

      expect(user.findUnique).toHaveBeenCalledTimes(PRESENCE_RESYNC_MIN_BATCH);
    });

    it('sizes a batch so that everyone online is re-derived within the resync delay', () => {
      expect(presenceResyncBatch(0)).toBe(PRESENCE_RESYNC_MIN_BATCH);
      expect(presenceResyncBatch(600)).toBe(PRESENCE_RESYNC_MIN_BATCH);
      expect(presenceResyncBatch(5_000)).toBe(417);
      expect(presenceResyncBatch(20_000)).toBe(1_667);
      expect(presenceResyncBatch(100_000)).toBe(PRESENCE_RESYNC_MAX_BATCH);
    });

    it('re-derives a batch a few users at a time', async () => {
      for (let id = 1; id <= PRESENCE_RESYNC_CONCURRENCY + 1; id++) {
        await service.onSocketOpen(id, id);
      }
      user.findUnique.mockClear();
      user.findUnique.mockReturnValue(new Promise(() => undefined));

      now.mockReturnValue(1_000_000 + PRESENCE_RESYNC_AFTER_MS);
      void service.resyncStale();
      await new Promise(setImmediate);

      expect(user.findUnique).toHaveBeenCalledTimes(PRESENCE_RESYNC_CONCURRENCY);
    });

    it('carries on past a user whose derivation fails', async () => {
      await service.onSocketOpen(1, 11);
      await service.onSocketOpen(2, 21);
      user.findUnique.mockClear();
      user.findUnique
        .mockRejectedValueOnce(new Error('database down'))
        .mockResolvedValueOnce({ username: 'other', nickname: null });

      now.mockReturnValue(1_000_000 + PRESENCE_RESYNC_AFTER_MS);
      await service.resyncStale();

      expect(user.findUnique).toHaveBeenCalledTimes(2);
      expect(service.get(2)).toMatchObject({ username: 'other' });
    });
  });

  it('answers not found for an offline user, friend or not', async () => {
    friendsService.areFriends.mockResolvedValue(true);

    await expect(service.presenceOf(1, 2)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PresenceService wiring', () => {
  it('has its resync run by the scheduler', async () => {
    const module = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        PresenceService,
        { provide: PrismaService, useValue: {} },
        { provide: FriendsService, useValue: {} },
        { provide: MultiplayerService, useValue: {} },
      ],
    }).compile();
    await module.init();

    expect(module.get(SchedulerRegistry).getIntervals()).toHaveLength(1);

    await module.close();
  });

  it('listens to the domain events the rest of the backend emits', async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        PresenceService,
        { provide: PrismaService, useValue: {} },
        { provide: FriendsService, useValue: {} },
        { provide: MultiplayerService, useValue: {} },
      ],
    }).compile();
    await module.init();
    const service = module.get(PresenceService);
    const activity = jest.spyOn(service, 'onActivityChanged').mockResolvedValue();
    const friendship = jest.spyOn(service, 'onFriendshipChanged').mockResolvedValue();
    const project = jest.spyOn(service, 'onProjectChanged').mockResolvedValue();
    const events = module.get(EventEmitter2);

    await events.emitAsync(ACTIVITY_CHANGED, new ActivityChangedEvent(1));
    await events.emitAsync(FRIENDSHIP_CHANGED, new FriendshipChangedEvent(1, 2));
    await events.emitAsync(PROJECT_CHANGED, new ProjectChangedEvent(7));

    expect(activity).toHaveBeenCalledWith(new ActivityChangedEvent(1));
    expect(friendship).toHaveBeenCalledWith(new FriendshipChangedEvent(1, 2));
    expect(project).toHaveBeenCalledWith(new ProjectChangedEvent(7));

    await module.close();
  });
});
