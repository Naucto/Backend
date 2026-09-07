import { Test } from "@nestjs/testing";
import { PrismaService } from "@ourPrisma/prisma.service";
import { FriendsService } from "@friends/friends.service";
import { PresenceService } from "./presence.service";

describe("PresenceService", () => {
  let service: PresenceService;
  const gameSession = { findFirst: jest.fn() };
  const workSession = { findFirst: jest.fn() };
  const user = { findUnique: jest.fn() };
  const project = { findFirst: jest.fn() };
  const friendsService = { friendIdsOf: jest.fn(), areFriends: jest.fn() };
  const fanOut = jest.fn();

  beforeEach(async () => {
    jest.resetAllMocks();
    gameSession.findFirst.mockResolvedValue(null);
    workSession.findFirst.mockResolvedValue(null);
    user.findUnique.mockResolvedValue({ username: "louis", nickname: null });
    project.findFirst.mockResolvedValue(null);
    friendsService.friendIdsOf.mockResolvedValue([]);
    friendsService.areFriends.mockResolvedValue(false);

    const module = await Test.createTestingModule({
      providers: [
        PresenceService,
        { provide: PrismaService, useValue: { gameSession, workSession, user, project } },
        { provide: FriendsService, useValue: friendsService }
      ]
    }).compile();

    service = module.get(PresenceService);
    service.setFanOut(fanOut);
  });

  it("comes online IDLE on first socket and offline when the last one closes", async () => {
    await service.onSocketOpen(1);
    expect(service.get(1)).toMatchObject({ userId: 1, kind: "IDLE" });

    await service.onSocketOpen(1);
    await service.onSocketClose(1);
    expect(service.isOnline(1)).toBe(true);

    await service.onSocketClose(1);
    expect(service.isOnline(1)).toBe(false);
  });

  it("fans changes out to online friends only", async () => {
    // 1 and 2 are friends; 2 is online, 3 is a friend but offline.
    friendsService.friendIdsOf.mockImplementation(async (id: number) =>
      id === 1 ? [2, 3] : [1]
    );
    await service.onSocketOpen(2);
    fanOut.mockClear();

    await service.onSocketOpen(1);
    expect(fanOut).toHaveBeenCalledTimes(1);
    expect(fanOut).toHaveBeenCalledWith(2, {
      type: "presence:changed",
      payload: expect.objectContaining({ userId: 1, kind: "IDLE" })
    });

    fanOut.mockClear();
    await service.onSocketClose(1);
    expect(fanOut).toHaveBeenCalledWith(2, {
      type: "presence:offline",
      payload: { userId: 1 }
    });
  });

  it("accepts PLAYING from the client but never HOSTING/BUILDING claims", async () => {
    await service.onSocketOpen(1);

    await service.onSet(1, { kind: "PLAYING", releaseId: 42 });
    expect(service.get(1)).toMatchObject({ kind: "PLAYING", releaseId: 42 });

    await service.onSet(1, { kind: "HOSTING", sessionId: "fake" });
    expect(service.get(1)).toMatchObject({ kind: "IDLE", sessionId: null });
  });

  it("derives HOSTING from a live hosted game session", async () => {
    gameSession.findFirst.mockResolvedValue({
      sessionId: "uuid",
      projectId: 5,
      title: "Race",
      maxPlayers: 4,
      visibility: "PUBLIC",
      project: { publishedAt: new Date(), iconUrl: null, name: "Race" },
      _count: { otherUsers: 2 }
    });

    await service.onSocketOpen(1);

    expect(service.get(1)).toMatchObject({
      kind: "HOSTING",
      sessionId: "uuid",
      projectId: 5,
      title: "Race",
      players: 3,
      maxPlayers: 4,
      joinable: true
    });
  });

  it("marks invite-code sessions as not joinable and narrows FRIENDS_ONLY per viewer", async () => {
    gameSession.findFirst.mockResolvedValue({
      sessionId: "uuid",
      projectId: 5,
      title: "Race",
      maxPlayers: 4,
      visibility: "INVITE_CODE",
      project: { publishedAt: null, iconUrl: null, name: "Race" },
      _count: { otherUsers: 0 }
    });
    await service.onSocketOpen(1);
    expect(service.get(1)?.joinable).toBe(false);

    gameSession.findFirst.mockResolvedValue({
      sessionId: "uuid2",
      projectId: 5,
      title: "Race",
      maxPlayers: 4,
      visibility: "FRIENDS_ONLY",
      project: { publishedAt: null, iconUrl: null, name: "Race" },
      _count: { otherUsers: 0 }
    });
    await service.onSet(1, { kind: "IDLE" });

    await expect(service.presenceOf(9, 1)).resolves.toMatchObject({ joinable: false });
    friendsService.areFriends.mockResolvedValue(true);
    await expect(service.presenceOf(9, 1)).resolves.toMatchObject({ joinable: true });
  });

  it("derives BUILDING from a work session", async () => {
    workSession.findFirst.mockResolvedValue({
      projectId: 7,
      project: { name: "Platformer", iconUrl: null, _count: { collaborators: 1 } }
    });

    await service.onSocketOpen(1);

    expect(service.get(1)).toMatchObject({
      kind: "BUILDING",
      projectId: 7,
      title: "Platformer"
    });
  });

  it("keeps `since` when the activity does not change", async () => {
    await service.onSocketOpen(1);
    const since = service.get(1)!.since;

    await service.onSet(1, { kind: "IDLE" });
    expect(service.get(1)!.since).toBe(since);
  });

  it("returns the presence of online friends for the snapshot", async () => {
    await service.onSocketOpen(2);
    friendsService.friendIdsOf.mockResolvedValue([2, 3]);

    const snapshot = await service.friendsPresence(1);

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ userId: 2 });
  });

  it("returns null presence for an offline user", async () => {
    await expect(service.presenceOf(1, 2)).resolves.toBeNull();
  });
});
