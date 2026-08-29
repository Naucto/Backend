import {
  BadRequestException,
  ConflictException,
  NotFoundException
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "@ourPrisma/prisma.service";
import { UserService } from "@user/user.service";
import { NotificationsService } from "src/notifications/notifications.service";
import { FriendsService } from "./friends.service";

const alice = { id: 1, username: "alice", nickname: null, deletedAt: null };
const bob = { id: 2, username: "bob", nickname: "Bobby", deletedAt: null };
const gone = { id: 3, username: "gone", nickname: null, deletedAt: new Date() };

describe("FriendsService", () => {
  let service: FriendsService;

  const friendship = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn()
  };
  const friendRequest = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn()
  };
  const gameSession = { findMany: jest.fn(), findFirst: jest.fn() };
  const user = { findUnique: jest.fn() };
  const $transaction = jest.fn();
  const userService = { findIdByFriendCode: jest.fn() };
  const notificationsService = { createNotification: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    $transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({ friendship, friendRequest })
    );
    friendship.findMany.mockResolvedValue([]);
    notificationsService.createNotification.mockResolvedValue({});

    const module = await Test.createTestingModule({
      providers: [
        FriendsService,
        {
          provide: PrismaService,
          useValue: { friendship, friendRequest, gameSession, user, $transaction }
        },
        { provide: UserService, useValue: userService },
        { provide: NotificationsService, useValue: notificationsService }
      ]
    }).compile();

    service = module.get(FriendsService);
  });

  describe("areFriends", () => {
    it("looks the pair up in canonical order", async () => {
      friendship.findUnique.mockResolvedValue({ id: 9 });

      await expect(service.areFriends(5, 2)).resolves.toBe(true);
      expect(friendship.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userAId_userBId: { userAId: 2, userBId: 5 } }
        })
      );
    });

    it("is false for the same user without querying", async () => {
      await expect(service.areFriends(1, 1)).resolves.toBe(false);
      expect(friendship.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("maps friendships to the other user and skips deleted accounts", async () => {
      const since = new Date("2026-01-01T00:00:00.000Z");
      friendship.findMany.mockResolvedValue([
        { userAId: 1, userBId: 2, userA: alice, userB: bob, createdAt: since },
        { userAId: 1, userBId: 3, userA: alice, userB: gone, createdAt: since }
      ]);

      await expect(service.list(1)).resolves.toEqual([
        { id: 2, username: "bob", nickname: "Bobby", since: since.toISOString() }
      ]);
    });
  });

  describe("sendRequest", () => {
    it("creates a request and notifies the target", async () => {
      user.findUnique.mockResolvedValue({ id: 2, deletedAt: null });
      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValue(null);
      friendRequest.create.mockResolvedValue({
        id: 10,
        fromId: 1,
        toId: 2,
        from: alice,
        to: bob,
        createdAt: new Date("2026-01-01T00:00:00.000Z")
      });

      const result = await service.sendRequest(1, { userId: 2 });

      expect(result).toMatchObject({ id: 10, from: { id: 1 }, to: { id: 2 } });
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          kind: "FRIEND_REQUEST",
          data: { requestId: 10, fromUserId: 1 }
        })
      );
    });

    it("resolves the target from a friend code", async () => {
      userService.findIdByFriendCode.mockResolvedValue(2);
      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValue(null);
      friendRequest.create.mockResolvedValue({
        id: 10, fromId: 1, toId: 2, from: alice, to: bob, createdAt: new Date()
      });

      await service.sendRequest(1, { friendCode: "7k3q-w9zb" });

      expect(userService.findIdByFriendCode).toHaveBeenCalledWith("7k3q-w9zb");
      expect(friendRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { fromId: 1, toId: 2 } })
      );
    });

    it("404s on an unknown friend code", async () => {
      userService.findIdByFriendCode.mockResolvedValue(null);

      await expect(
        service.sendRequest(1, { friendCode: "XXXXXXXX" })
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects self, existing friends and duplicate requests", async () => {
      user.findUnique.mockResolvedValue({ id: 1, deletedAt: null });
      await expect(service.sendRequest(1, { userId: 1 })).rejects.toBeInstanceOf(
        BadRequestException
      );

      user.findUnique.mockResolvedValue({ id: 2, deletedAt: null });
      friendship.findUnique.mockResolvedValueOnce({ id: 1 });
      await expect(service.sendRequest(1, { userId: 2 })).rejects.toBeInstanceOf(
        ConflictException
      );

      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 4 });
      await expect(service.sendRequest(1, { userId: 2 })).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it("auto-accepts a crossed request instead of creating one", async () => {
      user.findUnique.mockResolvedValue({ id: 2, deletedAt: null });
      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValueOnce({ id: 4 });
      friendRequest.findFirst.mockResolvedValue({
        id: 4, fromId: 2, toId: 1, to: alice
      });
      friendRequest.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.sendRequest(1, { userId: 2 })).resolves.toBeNull();

      expect(friendRequest.create).not.toHaveBeenCalled();
      expect(friendship.create).toHaveBeenCalledWith({
        data: { userAId: 1, userBId: 2 }
      });
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 2, kind: "FRIEND_ACCEPTED" })
      );
    });
  });

  describe("accept / decline / remove", () => {
    it("accept only works on the recipient's own incoming request", async () => {
      friendRequest.findFirst.mockResolvedValue(null);

      await expect(service.accept(1, 99)).rejects.toBeInstanceOf(NotFoundException);
      expect(friendRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 99, toId: 1 } })
      );
    });

    it("accept deletes the request and creates the canonical friendship", async () => {
      friendRequest.findFirst.mockResolvedValue({
        id: 4, fromId: 5, toId: 1, to: alice
      });
      friendRequest.deleteMany.mockResolvedValue({ count: 0 });

      await service.accept(1, 4);

      expect(friendRequest.delete).toHaveBeenCalledWith({ where: { id: 4 } });
      expect(friendship.create).toHaveBeenCalledWith({
        data: { userAId: 1, userBId: 5 }
      });
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 5, kind: "FRIEND_ACCEPTED" })
      );
    });

    it("decline removes an incoming or outgoing request and 404s otherwise", async () => {
      friendRequest.deleteMany.mockResolvedValueOnce({ count: 1 });
      await service.decline(1, 4);
      expect(friendRequest.deleteMany).toHaveBeenCalledWith({
        where: { id: 4, OR: [{ toId: 1 }, { fromId: 1 }] }
      });

      friendRequest.deleteMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.decline(1, 4)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("remove deletes the canonical pair and 404s when not friends", async () => {
      friendship.deleteMany.mockResolvedValueOnce({ count: 1 });
      await service.remove(7, 2);
      expect(friendship.deleteMany).toHaveBeenCalledWith({
        where: { userAId: 2, userBId: 7 }
      });

      friendship.deleteMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.remove(7, 2)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("friendshipStatus", () => {
    it("reports FRIENDS, PENDING or NONE", async () => {
      friendship.findUnique.mockResolvedValueOnce({ id: 1 });
      await expect(service.friendshipStatus(1, 2)).resolves.toBe("FRIENDS");

      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findFirst.mockResolvedValueOnce({ id: 3 });
      await expect(service.friendshipStatus(1, 2)).resolves.toBe("PENDING");

      friendRequest.findFirst.mockResolvedValueOnce(null);
      await expect(service.friendshipStatus(1, 2)).resolves.toBe("NONE");
    });
  });

  describe("requests", () => {
    it("adds mutual counts and playedYourGame on incoming requests", async () => {
      friendRequest.findMany.mockResolvedValue([
        { id: 4, fromId: 2, toId: 1, from: bob, to: alice, createdAt: new Date() }
      ]);
      // My friends: 8, 9. Bob's friends: 9, 10.
      friendship.findMany
        .mockResolvedValueOnce([
          { userAId: 1, userBId: 8 },
          { userAId: 1, userBId: 9 }
        ])
        .mockResolvedValueOnce([
          { userAId: 2, userBId: 9 },
          { userAId: 2, userBId: 10 }
        ]);
      gameSession.findFirst.mockResolvedValue({ id: 1 });

      const [request] = await service.requests(1);

      expect(request).toMatchObject({
        id: 4,
        from: { id: 2, nickname: "Bobby" },
        mutuals: 1,
        playedYourGame: true
      });
    });
  });

  describe("recentPlayers", () => {
    it("dedupes participants, newest first, with friend flag", async () => {
      const older = new Date("2026-01-01T00:00:00.000Z");
      const newer = new Date("2026-02-01T00:00:00.000Z");
      gameSession.findMany.mockResolvedValue([
        {
          startedAt: newer,
          host: alice,
          otherUsers: [bob, gone],
          project: { name: "Newer game" }
        },
        {
          startedAt: older,
          host: bob,
          otherUsers: [alice, { id: 4, username: "dan", nickname: null, deletedAt: null }],
          project: { name: "Older game" }
        }
      ]);
      friendship.findMany.mockResolvedValue([{ userAId: 1, userBId: 2 }]);

      await expect(service.recentPlayers(1)).resolves.toEqual([
        {
          id: 2, username: "bob", nickname: "Bobby",
          game: "Newer game", playedAt: newer.toISOString(), friend: true
        },
        {
          id: 4, username: "dan", nickname: null,
          game: "Older game", playedAt: older.toISOString(), friend: false
        }
      ]);
    });
  });
});
