import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { uuidOf } from '../../../test/uuid';
import { FRIENDSHIP_CHANGED, FriendshipChangedEvent } from '../../common/domain-events';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../user/user.service';
import { FriendsService } from './friends.service';

const alice = { id: uuidOf(1), username: 'alice', nickname: null, deletedAt: null };
const bob = { id: uuidOf(2), username: 'bob', nickname: 'Bobby', deletedAt: null };
const gone = { id: uuidOf(3), username: 'gone', nickname: null, deletedAt: new Date() };

describe('FriendsService', () => {
  let service: FriendsService;

  const friendship = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  };
  const friendRequest = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    deleteMany: jest.fn(),
  };
  const gameSession = { findMany: jest.fn() };
  const user = { findUnique: jest.fn(), findMany: jest.fn() };
  const $transaction = jest.fn();
  const userService = { findIdByFriendCode: jest.fn() };
  const notificationsService = { notifyBestEffort: jest.fn() };
  const eventEmitter = { emit: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    $transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
      cb({ friendship, friendRequest }),
    );
    friendship.findMany.mockResolvedValue([]);
    notificationsService.notifyBestEffort.mockResolvedValue({});

    const module = await Test.createTestingModule({
      providers: [
        FriendsService,
        {
          provide: PrismaService,
          useValue: { friendship, friendRequest, gameSession, user, $transaction },
        },
        { provide: UserService, useValue: userService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get(FriendsService);
  });

  describe('areFriends', () => {
    it('looks the pair up in canonical order', async () => {
      friendship.findUnique.mockResolvedValue({ id: uuidOf(9) });

      await expect(service.areFriends(uuidOf(5), uuidOf(2))).resolves.toBe(true);
      expect(friendship.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userAId_userBId: { userAId: uuidOf(2), userBId: uuidOf(5) } },
        }),
      );
    });

    it('orders the pair as the database orders ids, digits before letters', async () => {
      const lower = '00000000-0000-4000-8000-00000000009f';
      const higher = '00000000-0000-4000-8000-0000000000a0';
      friendship.findUnique.mockResolvedValue(null);

      await service.areFriends(higher, lower);

      expect(friendship.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userAId_userBId: { userAId: lower, userBId: higher } },
        }),
      );
    });

    it('is false for the same user without querying', async () => {
      await expect(service.areFriends(uuidOf(1), uuidOf(1))).resolves.toBe(false);
      expect(friendship.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('maps friendships to the other user and skips deleted accounts', async () => {
      const since = new Date('2026-01-01T00:00:00.000Z');
      friendship.findMany.mockResolvedValue([
        { userAId: uuidOf(1), userBId: uuidOf(2), userA: alice, userB: bob, createdAt: since },
        { userAId: uuidOf(1), userBId: uuidOf(3), userA: alice, userB: gone, createdAt: since },
      ]);

      await expect(service.list(uuidOf(1))).resolves.toEqual([
        { id: uuidOf(2), username: 'bob', nickname: 'Bobby', since: since.toISOString() },
      ]);
    });
  });

  describe('sendRequest', () => {
    it('creates a request and notifies the target', async () => {
      user.findUnique.mockResolvedValue({ id: uuidOf(2), deletedAt: null });
      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValue(null);
      friendRequest.create.mockResolvedValue({
        id: uuidOf(10),
        fromId: uuidOf(1),
        toId: uuidOf(2),
        from: alice,
        to: bob,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      const result = await service.sendRequest(uuidOf(1), { userId: uuidOf(2) });

      expect(result).toMatchObject({
        id: uuidOf(10),
        from: { id: uuidOf(1) },
        to: { id: uuidOf(2) },
      });
      expect(notificationsService.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: uuidOf(2),
          kind: 'FRIEND_REQUEST',
          data: { requestId: uuidOf(10), fromUserId: uuidOf(1) },
        }),
      );
    });

    it('resolves the target from a friend code', async () => {
      userService.findIdByFriendCode.mockResolvedValue(uuidOf(2));
      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValue(null);
      friendRequest.create.mockResolvedValue({
        id: uuidOf(10),
        fromId: uuidOf(1),
        toId: uuidOf(2),
        from: alice,
        to: bob,
        createdAt: new Date(),
      });

      await service.sendRequest(uuidOf(1), { friendCode: '7k3q-w9zb' });

      expect(userService.findIdByFriendCode).toHaveBeenCalledWith('7k3q-w9zb');
      expect(friendRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { fromId: uuidOf(1), toId: uuidOf(2) } }),
      );
    });

    it('resolves the target from a handle', async () => {
      user.findUnique.mockResolvedValue({ id: uuidOf(2), deletedAt: null });
      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValue(null);
      friendRequest.create.mockResolvedValue({
        id: uuidOf(11),
        fromId: uuidOf(1),
        toId: uuidOf(2),
        from: alice,
        to: bob,
        createdAt: new Date(),
      });

      await service.sendRequest(uuidOf(1), { username: 'bob' });

      expect(user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { username: 'bob' } }),
      );
      expect(friendRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { fromId: uuidOf(1), toId: uuidOf(2) } }),
      );
    });

    it('404s on an unknown handle', async () => {
      user.findUnique.mockResolvedValue(null);

      await expect(service.sendRequest(uuidOf(1), { username: 'nobody' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s on an unknown friend code', async () => {
      userService.findIdByFriendCode.mockResolvedValue(null);

      await expect(
        service.sendRequest(uuidOf(1), { friendCode: 'XXXXXXXX' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a request that names nobody', async () => {
      await expect(service.sendRequest(uuidOf(1), {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects self, existing friends and duplicate requests', async () => {
      user.findUnique.mockResolvedValue({ id: uuidOf(1), deletedAt: null });
      await expect(service.sendRequest(uuidOf(1), { userId: uuidOf(1) })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      user.findUnique.mockResolvedValue({ id: uuidOf(2), deletedAt: null });
      friendship.findUnique.mockResolvedValueOnce({ id: uuidOf(1) });
      await expect(service.sendRequest(uuidOf(1), { userId: uuidOf(2) })).rejects.toBeInstanceOf(
        ConflictException,
      );

      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValue(null);
      friendRequest.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.sendRequest(uuidOf(1), { userId: uuidOf(2) })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('auto-accepts a crossed request instead of creating one', async () => {
      user.findUnique.mockResolvedValue({ id: uuidOf(2), deletedAt: null });
      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findUnique.mockResolvedValueOnce({ id: uuidOf(4) });
      friendRequest.findFirst.mockResolvedValue({
        id: uuidOf(4),
        fromId: uuidOf(2),
        toId: uuidOf(1),
        to: alice,
      });
      friendRequest.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await expect(service.sendRequest(uuidOf(1), { userId: uuidOf(2) })).resolves.toBeNull();

      expect(friendRequest.create).not.toHaveBeenCalled();
      expect(friendship.createMany).toHaveBeenCalledWith({
        data: [{ userAId: uuidOf(1), userBId: uuidOf(2) }],
        skipDuplicates: true,
      });
      expect(notificationsService.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(2), kind: 'FRIEND_ACCEPTED' }),
      );
    });
  });

  describe('accept / decline / remove', () => {
    it("accept only works on the recipient's own incoming request", async () => {
      friendRequest.findFirst.mockResolvedValue(null);

      await expect(service.accept(uuidOf(1), uuidOf(99))).rejects.toBeInstanceOf(NotFoundException);
      expect(friendRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: uuidOf(99), toId: uuidOf(1) } }),
      );
    });

    it('accept deletes the request and creates the canonical friendship', async () => {
      friendRequest.findFirst.mockResolvedValue({
        id: uuidOf(4),
        fromId: uuidOf(5),
        toId: uuidOf(1),
        to: alice,
      });
      friendRequest.deleteMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await service.accept(uuidOf(1), uuidOf(4));

      expect(friendRequest.deleteMany).toHaveBeenCalledWith({
        where: { id: uuidOf(4), toId: uuidOf(1) },
      });
      expect(friendship.createMany).toHaveBeenCalledWith({
        data: [{ userAId: uuidOf(1), userBId: uuidOf(5) }],
        skipDuplicates: true,
      });
      expect(notificationsService.notifyBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ userId: uuidOf(5), kind: 'FRIEND_ACCEPTED' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        FRIENDSHIP_CHANGED,
        new FriendshipChangedEvent(uuidOf(1), uuidOf(5)),
      );
    });

    it('accept answers not found when the request went away after it was read', async () => {
      friendRequest.findFirst.mockResolvedValue({
        id: uuidOf(4),
        fromId: uuidOf(5),
        toId: uuidOf(1),
        to: alice,
      });
      friendRequest.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.accept(uuidOf(1), uuidOf(4))).rejects.toBeInstanceOf(NotFoundException);
      expect(friendship.createMany).not.toHaveBeenCalled();
      expect(notificationsService.notifyBestEffort).not.toHaveBeenCalled();
    });

    it('decline removes an incoming or outgoing request and 404s otherwise', async () => {
      friendRequest.deleteMany.mockResolvedValueOnce({ count: 1 });
      await service.decline(uuidOf(1), uuidOf(4));
      expect(friendRequest.deleteMany).toHaveBeenCalledWith({
        where: { id: uuidOf(4), OR: [{ toId: uuidOf(1) }, { fromId: uuidOf(1) }] },
      });

      friendRequest.deleteMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.decline(uuidOf(1), uuidOf(4))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('remove deletes the canonical pair and 404s when not friends', async () => {
      friendship.deleteMany.mockResolvedValueOnce({ count: 1 });
      await service.remove(uuidOf(7), uuidOf(2));
      expect(friendship.deleteMany).toHaveBeenCalledWith({
        where: { userAId: uuidOf(2), userBId: uuidOf(7) },
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        FRIENDSHIP_CHANGED,
        new FriendshipChangedEvent(uuidOf(7), uuidOf(2)),
      );

      friendship.deleteMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.remove(uuidOf(7), uuidOf(2))).rejects.toBeInstanceOf(NotFoundException);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('friendshipStatus', () => {
    it('reports FRIENDS, PENDING or NONE', async () => {
      friendship.findUnique.mockResolvedValueOnce({ id: uuidOf(1) });
      await expect(service.friendshipStatus(uuidOf(1), uuidOf(2))).resolves.toBe('FRIENDS');

      friendship.findUnique.mockResolvedValue(null);
      friendRequest.findFirst.mockResolvedValueOnce({ id: uuidOf(3) });
      await expect(service.friendshipStatus(uuidOf(1), uuidOf(2))).resolves.toBe('PENDING');

      friendRequest.findFirst.mockResolvedValueOnce(null);
      await expect(service.friendshipStatus(uuidOf(1), uuidOf(2))).resolves.toBe('NONE');
    });
  });

  describe('requests', () => {
    const carol = { id: uuidOf(5), username: 'carol', nickname: null, deletedAt: null };

    it('adds mutual counts, and playedYourGame on incoming requests', async () => {
      friendRequest.findMany.mockResolvedValue([
        {
          id: uuidOf(4),
          fromId: uuidOf(2),
          toId: uuidOf(1),
          from: bob,
          to: alice,
          createdAt: new Date(),
        },
        {
          id: uuidOf(6),
          fromId: uuidOf(1),
          toId: uuidOf(5),
          from: alice,
          to: carol,
          createdAt: new Date(),
        },
      ]);
      // My friends: 8, 9. Bob's: 9, 10. Carol's: 8, 9.
      friendship.findMany
        .mockResolvedValueOnce([
          { userAId: uuidOf(1), userBId: uuidOf(8) },
          { userAId: uuidOf(1), userBId: uuidOf(9) },
        ])
        .mockResolvedValueOnce([
          { userAId: uuidOf(2), userBId: uuidOf(9) },
          { userAId: uuidOf(2), userBId: uuidOf(10) },
          { userAId: uuidOf(5), userBId: uuidOf(8) },
          { userAId: uuidOf(5), userBId: uuidOf(9) },
        ]);
      user.findMany.mockResolvedValue([{ id: uuidOf(2) }]);

      const [incoming, outgoing] = await service.requests(uuidOf(1));

      expect(incoming).toMatchObject({
        id: uuidOf(4),
        from: { id: uuidOf(2), nickname: 'Bobby' },
        mutuals: 1,
        playedYourGame: true,
      });
      expect(outgoing).toMatchObject({ id: uuidOf(6), to: { id: uuidOf(5) }, mutuals: 2 });
      expect(outgoing).not.toHaveProperty('playedYourGame');
    });

    it('asks the database a fixed number of times, however many requests are pending', async () => {
      friendRequest.findMany.mockResolvedValue(
        [2, 5, 6, 7].map(uuidOf).map((fromId, index) => ({
          id: uuidOf(index),
          fromId,
          toId: uuidOf(1),
          from: { ...bob, id: fromId },
          to: alice,
          createdAt: new Date(),
        })),
      );
      user.findMany.mockResolvedValue([]);

      await service.requests(uuidOf(1));

      expect(friendship.findMany).toHaveBeenCalledTimes(2);
      expect(user.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('recentPlayers', () => {
    it('dedupes participants, newest first, with friend flag', async () => {
      const older = new Date('2026-01-01T00:00:00.000Z');
      const newer = new Date('2026-02-01T00:00:00.000Z');
      gameSession.findMany.mockResolvedValue([
        {
          startedAt: newer,
          host: alice,
          otherUsers: [bob, gone],
          project: { name: 'Newer draft', publishedName: 'Newer game' },
        },
        {
          startedAt: older,
          host: bob,
          otherUsers: [alice, { id: uuidOf(4), username: 'dan', nickname: null, deletedAt: null }],
          project: { name: 'Older game', publishedName: null },
        },
      ]);
      friendship.findMany.mockResolvedValue([{ userAId: uuidOf(1), userBId: uuidOf(2) }]);

      await expect(service.recentPlayers(uuidOf(1))).resolves.toEqual([
        {
          id: uuidOf(2),
          username: 'bob',
          nickname: 'Bobby',
          game: 'Newer game',
          playedAt: newer.toISOString(),
          friend: true,
        },
        {
          id: uuidOf(4),
          username: 'dan',
          nickname: null,
          game: 'Older game',
          playedAt: older.toISOString(),
          friend: false,
        },
      ]);
    });
  });
});
