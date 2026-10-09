import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { ADMIN, MODERATOR, USER } from '../../auth/access/roles';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsFactService } from '../analytics/analytics-fact.service';
import { UserService } from './user.service';

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('UserService', () => {
  let service: UserService;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  const facts = { record: jest.fn() };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
    facts.record.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: PrismaService,
          useValue: {
            $connect: jest.fn(),
            $disconnect: jest.fn(),
            ...prisma,
          },
        },
        { provide: AnalyticsFactService, useValue: facts },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('account creation', () => {
    it('records a signup in the transaction that creates a password account', async () => {
      prisma.user.create.mockResolvedValue({ id: 5 });

      await service.create({ email: 'a@b.c', username: 'abc', password: 'Secret-123' });

      expect(facts.record).toHaveBeenCalledWith(
        expect.objectContaining({ user: prisma.user }),
        expect.objectContaining({ type: 'SIGNUP', actorUserId: 5 }),
      );
    });

    it('records a signup for an account created by OAuth, under a key free of the account id', async () => {
      prisma.user.create.mockResolvedValue({ id: 5 });

      await service.createOAuthUser('a@b.c', 'abc');

      const [, fact] = facts.record.mock.calls[0] as [unknown, { dedupeKey: string }];
      expect(fact.dedupeKey).toMatch(
        /^signup:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('records nothing when the account cannot be created', async () => {
      prisma.user.create.mockRejectedValue(new Error('taken'));

      await expect(service.createOAuthUser('a@b.c', 'abc')).rejects.toThrow('taken');

      expect(facts.record).not.toHaveBeenCalled();
    });
  });

  describe('updateMyProfile', () => {
    it('should write the display name', async () => {
      prisma.user.update.mockResolvedValue({});

      await service.updateMyProfile(1, { nickname: 'Louis' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { nickname: 'Louis' } }),
      );
    });

    it('should leave alone what the request did not mention', async () => {
      prisma.user.update.mockResolvedValue({});

      await service.updateMyProfile(1, { colour: 'JADE' });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { colour: 'JADE' } }),
      );
    });

    it('should name the handle that collided rather than leak a database code', async () => {
      prisma.user.update.mockRejectedValue(uniqueViolation());

      await expect(service.updateMyProfile(1, { username: 'louis' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('searchPublic', () => {
    const answering = (exact: unknown[], partial: unknown[]): void => {
      prisma.user.findMany.mockImplementation(async ({ where }: { where: { OR?: unknown } }) =>
        where.OR ? partial : exact,
      );
    };

    it('should put an exact handle first', async () => {
      answering(
        [{ id: 2, username: 'louis', nickname: null }],
        [
          { id: 1, username: 'louisette', nickname: null },
          { id: 2, username: 'louis', nickname: null },
        ],
      );

      const hits = await service.searchPublic('Louis', 10);

      expect(hits.map((hit) => hit.username)).toEqual(['louis', 'louisette']);
    });

    it('should keep the exact handle when partial matches alone fill the page', async () => {
      answering(
        [{ id: 4, username: 'max', nickname: null }],
        [
          { id: 1, username: 'amax', nickname: null },
          { id: 2, username: 'bigmax', nickname: null },
          { id: 3, username: 'climax', nickname: null },
        ],
      );

      const hits = await service.searchPublic('max', 3);

      expect(hits.map((hit) => hit.username)).toEqual(['max', 'amax', 'bigmax']);
    });

    it('should never offer a deleted account', async () => {
      answering([], []);

      await service.searchPublic('lou', 5);

      expect(prisma.user.findMany).toHaveBeenCalled();
      for (const [args] of prisma.user.findMany.mock.calls) {
        expect(args).toMatchObject({ where: { deletedAt: null }, take: 5 });
      }
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findPublicProfile', () => {
    it('should return a public user profile', async () => {
      const publicProfile = {
        id: 1,
        username: 'alice',
        nickname: 'Ali',
        description: 'Hello',
        createdAt: new Date('2025-03-14T09:00:00.000Z'),
      };

      prisma.user.findUnique.mockResolvedValue(publicProfile);

      await expect(service.findPublicProfile(1)).resolves.toEqual(publicProfile);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        select: {
          id: true,
          username: true,
          nickname: true,
          description: true,
          colour: true,
          createdAt: true,
        },
      });
    });

    it('should throw a NotFoundException when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findPublicProfile(42)).rejects.toThrow(
        new NotFoundException('User with ID 42 not found'),
      );
    });
  });

  describe('findPublicProfileByUsername', () => {
    it('should return a public user profile by username', async () => {
      const publicProfile = {
        id: 1,
        username: 'Madeline',
        nickname: 'Maddy',
        description: 'Hello',
      };

      prisma.user.findUnique.mockResolvedValue(publicProfile);

      await expect(service.findPublicProfileByUsername('Madeline')).resolves.toEqual(publicProfile);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { username: 'Madeline' },
        select: {
          id: true,
          username: true,
          nickname: true,
          description: true,
          colour: true,
          createdAt: true,
        },
      });
    });

    it('should throw a NotFoundException when username does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findPublicProfileByUsername('unknown')).rejects.toThrow(
        new NotFoundException('User with username unknown not found'),
      );
    });
  });

  describe('getMe', () => {
    it('returns the stored friend code and join policy, and whether there is a password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: '7K3QW9ZB',
        sessionJoinPolicy: 'FRIENDS',
        password: 'hash',
      });

      await expect(service.getMe(1)).resolves.toEqual({
        friendCode: '7K3QW9ZB',
        sessionJoinPolicy: 'FRIENDS',
        hasPassword: true,
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('lazily mints a friend code when the user has none', async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: null,
        sessionJoinPolicy: 'ANYONE',
      });
      prisma.user.update.mockResolvedValue({ id: 1 });

      const me = await service.getMe(1);

      expect(me.friendCode).toHaveLength(8);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { friendCode: me.friendCode },
        }),
      );
    });

    it('retries on a friend code collision', async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: null,
        sessionJoinPolicy: 'ANYONE',
      });
      prisma.user.update.mockRejectedValueOnce(uniqueViolation()).mockResolvedValueOnce({ id: 1 });

      const me = await service.getMe(1);

      expect(me.friendCode).toHaveLength(8);
      expect(prisma.user.update).toHaveBeenCalledTimes(2);
    });

    it('gives up after repeated collisions', async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: null,
        sessionJoinPolicy: 'ANYONE',
      });
      prisma.user.update.mockRejectedValue(uniqueViolation());

      await expect(service.getMe(1)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFound for an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe(42)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('persists the join policy and returns the settings', async () => {
      prisma.user.update.mockResolvedValue({ id: 1 });
      prisma.user.findUnique.mockResolvedValue({
        friendCode: '7K3QW9ZB',
        sessionJoinPolicy: 'CODE_ONLY',
        password: null,
      });

      await expect(service.updateMe(1, { sessionJoinPolicy: 'CODE_ONLY' })).resolves.toEqual({
        friendCode: '7K3QW9ZB',
        sessionJoinPolicy: 'CODE_ONLY',
        hasPassword: false,
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { sessionJoinPolicy: 'CODE_ONLY' } }),
      );
    });

    it('does not write when nothing changed', async () => {
      prisma.user.findUnique.mockResolvedValue({
        friendCode: '7K3QW9ZB',
        sessionJoinPolicy: 'ANYONE',
      });

      await service.updateMe(1, {});

      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('getUserRole', () => {
    it('reads the stored role', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: ADMIN });

      await expect(service.getUserRole(1)).resolves.toBe(ADMIN);
    });

    it('reads a stored value the hierarchy does not know as the least privilege', async () => {
      prisma.user.findUnique.mockResolvedValue({ role: 'Superuser' });

      await expect(service.getUserRole(1)).resolves.toBe(USER);
    });

    it('answers not found for an unknown id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getUserRole(42)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it.each([
      [{ email: 'taken@example.com' }, { id: 2 }, 'EMAIL_TAKEN'],
      [{ email: 'mine@example.com', username: 'taken' }, { id: 1 }, 'USERNAME_TAKEN'],
      [{ username: 'taken' }, null, 'USERNAME_TAKEN'],
    ])('should name the field someone else holds: %j', async (body, emailOwner, code) => {
      prisma.user.update.mockRejectedValue(uniqueViolation());
      prisma.user.findUnique.mockResolvedValue(emailOwner);

      const conflict = service.update(1, body);

      await expect(conflict).rejects.toBeInstanceOf(ConflictException);
      await expect(conflict).rejects.toMatchObject({
        response: { violations: [expect.objectContaining({ code })] },
      });
    });

    it('replaces the role, so an admin can demote', async () => {
      prisma.user.update.mockResolvedValue({ id: 1, role: MODERATOR });

      await service.update(1, { role: MODERATOR });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: { role: MODERATOR } }),
      );
    });

    it('should answer not found for an unknown id', async () => {
      prisma.user.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(service.update(42, { nickname: 'Ada' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('regenerateFriendCode', () => {
    it('replaces the code even when one already exists', async () => {
      prisma.user.update.mockResolvedValue({ id: 1 });
      prisma.user.findUnique.mockResolvedValue({
        friendCode: 'NEWCODE1',
        sessionJoinPolicy: 'ANYONE',
        password: null,
      });

      await expect(service.regenerateFriendCode(1)).resolves.toEqual({
        friendCode: 'NEWCODE1',
        sessionJoinPolicy: 'ANYONE',
        hasPassword: false,
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { friendCode: expect.any(String) },
        }),
      );
    });
  });

  describe('findIdByFriendCode', () => {
    it('normalizes the code and resolves a live user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7, deletedAt: null });

      await expect(service.findIdByFriendCode('7k3q-w9zb')).resolves.toBe(7);
      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { friendCode: '7K3QW9ZB' } }),
      );
    });

    it('returns null for malformed codes without querying', async () => {
      await expect(service.findIdByFriendCode('nope')).resolves.toBeNull();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('returns null for a deleted user', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 7, deletedAt: new Date() });

      await expect(service.findIdByFriendCode('7K3QW9ZB')).resolves.toBeNull();
    });
  });
});
