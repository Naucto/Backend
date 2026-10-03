import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from '../routes/friends/friends.service';
import { HostedSession, MultiplayerService } from '../routes/multiplayer/multiplayer.service';
import { PresenceService } from './presence.service';

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

  it('comes online IDLE on first socket and offline when the last one closes', async () => {
    await service.onSocketOpen(1);
    expect(service.get(1)).toMatchObject({ userId: 1, kind: 'IDLE' });

    await service.onSocketOpen(1);
    await service.onSocketClose(1);
    expect(service.get(1)).not.toBeNull();

    await service.onSocketClose(1);
    expect(service.get(1)).toBeNull();
  });

  it('counts both sockets of a user whose two tabs open together', async () => {
    await Promise.all([service.onSocketOpen(1), service.onSocketOpen(1)]);

    await service.onSocketClose(1);
    expect(service.get(1)).not.toBeNull();

    await service.onSocketClose(1);
    expect(service.get(1)).toBeNull();
  });

  it('leaves nobody online when a socket closes while its open is still deriving', async () => {
    friendsService.friendIdsOf.mockImplementation(async (id: number) => (id === 1 ? [2] : [1]));
    await service.onSocketOpen(2);
    fanOut.mockClear();

    const opening = service.onSocketOpen(1);
    await service.onSocketClose(1);
    await opening;

    expect(service.get(1)).toBeNull();
    expect(fanOut).not.toHaveBeenCalledWith(
      2,
      expect.objectContaining({ type: 'presence:changed' }),
    );
  });

  it("keeps an activity declared while the socket's open is still deriving", async () => {
    const opening = service.onSocketOpen(1);
    await service.onSet(1, { kind: 'PLAYING', releaseId: 42 });
    await opening;

    expect(service.get(1)).toMatchObject({ kind: 'PLAYING', releaseId: 42 });
  });

  it('still counts a socket whose derivation failed', async () => {
    user.findUnique.mockRejectedValueOnce(new Error('database down'));
    await expect(service.onSocketOpen(1)).rejects.toThrow('database down');

    await service.onSocketOpen(1);
    await service.onSocketClose(1);
    await service.onSet(1, { kind: 'IDLE' });

    expect(service.get(1)).toMatchObject({ kind: 'IDLE' });
  });

  it('fans changes out to online friends only', async () => {
    // 1 and 2 are friends; 2 is online, 3 is a friend but offline.
    friendsService.friendIdsOf.mockImplementation(async (id: number) => (id === 1 ? [2, 3] : [1]));
    await service.onSocketOpen(2);
    fanOut.mockClear();

    await service.onSocketOpen(1);
    expect(fanOut).toHaveBeenCalledTimes(1);
    expect(fanOut).toHaveBeenCalledWith(2, {
      type: 'presence:changed',
      payload: expect.objectContaining({ userId: 1, kind: 'IDLE' }),
    });

    fanOut.mockClear();
    await service.onSocketClose(1);
    expect(fanOut).toHaveBeenCalledWith(2, {
      type: 'presence:offline',
      payload: { userId: 1 },
    });
  });

  it('accepts PLAYING from the client but never HOSTING/BUILDING claims', async () => {
    await service.onSocketOpen(1);

    await service.onSet(1, { kind: 'PLAYING', releaseId: 42 });
    expect(service.get(1)).toMatchObject({ kind: 'PLAYING', releaseId: 42 });

    await service.onSet(1, { kind: 'HOSTING' });
    expect(service.get(1)).toMatchObject({ kind: 'IDLE', sessionId: null });
  });

  it('derives HOSTING from a live hosted game session', async () => {
    multiplayerService.hostedSession.mockResolvedValue(
      aHostedSession({
        players: 3,
        project: { publishedAt: new Date(), iconUrl: null, name: 'Race' },
      }),
    );

    await service.onSocketOpen(1);

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

    await service.onSocketOpen(1);

    expect(service.get(1)?.joinable).toBe(false);
  });

  it('derives BUILDING from a work session', async () => {
    workSession.findFirst.mockResolvedValue({
      projectId: 7,
      project: { name: 'Platformer', iconUrl: null, _count: { collaborators: 1 } },
    });

    await service.onSocketOpen(1);

    expect(service.get(1)).toMatchObject({
      kind: 'BUILDING',
      projectId: 7,
      title: 'Platformer',
    });
  });

  it('keeps `since` when the activity does not change', async () => {
    await service.onSocketOpen(1);
    const since = service.get(1)!.since;

    await service.onSet(1, { kind: 'IDLE' });
    expect(service.get(1)!.since).toBe(since);
  });

  it('returns the presence of online friends for the snapshot', async () => {
    await service.onSocketOpen(2);
    friendsService.friendIdsOf.mockResolvedValue([2, 3]);

    const snapshot = await service.friendsPresence(1);

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ userId: 2 });
  });

  it("shows a user's presence to that user and to friends, and to nobody else", async () => {
    await service.onSocketOpen(1);

    await expect(service.presenceOf(1, 1)).resolves.toMatchObject({ userId: 1 });
    await expect(service.presenceOf(9, 1)).rejects.toBeInstanceOf(NotFoundException);

    friendsService.areFriends.mockResolvedValue(true);
    await expect(service.presenceOf(9, 1)).resolves.toMatchObject({ userId: 1 });
  });

  it('answers not found for an offline user, friend or not', async () => {
    friendsService.areFriends.mockResolvedValue(true);

    await expect(service.presenceOf(1, 2)).rejects.toBeInstanceOf(NotFoundException);
  });
});
