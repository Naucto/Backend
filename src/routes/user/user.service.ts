import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AnalyticsFactType, PersonalColour, Prisma, SessionJoinPolicy, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { parseRole, RoleName } from '../../auth/access/roles';
import { conflictViolation } from '../../common/validation/violation.exception';
import { isUniqueViolation, PrismaService } from '../../prisma/prisma.service';
import { AnalyticsFactService, signupFactKey } from '../analytics/analytics-fact.service';
import { CreateUserDto } from './dto/create-user.dto';
import { MeDto } from './dto/me.dto';
import { generateFriendCode, normalizeFriendCode } from './friend-code.util';

/** The columns anyone may read of a person. */
const PUBLIC_PROFILE_SELECT = {
  id: true,
  username: true,
  nickname: true,
  description: true,
  colour: true,
  createdAt: true,
} as const;

/** The columns a search hit carries. */
const PUBLIC_SEARCH_HIT_SELECT = { id: true, username: true, nickname: true } as const;

export type PublicSearchHit = Prisma.UserGetPayload<{ select: typeof PUBLIC_SEARCH_HIT_SELECT }>;

export type PublicProfile = Prisma.UserGetPayload<{ select: typeof PUBLIC_PROFILE_SELECT }>;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facts: AnalyticsFactService,
  ) {}
  private static readonly BCRYPT_SALT_ROUNDS = 10;
  private static readonly FRIEND_CODE_MAX_RETRIES = 5;

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { friendCode: true, sessionJoinPolicy: true, password: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // No account is created with a code; it is minted on first read.
    const friendCode = user.friendCode ?? (await this.assignFreshFriendCode(userId));

    return {
      friendCode,
      sessionJoinPolicy: user.sessionJoinPolicy,
      hasPassword: user.password !== null,
    };
  }

  async updateMe(userId: string, data: { sessionJoinPolicy?: SessionJoinPolicy }): Promise<MeDto> {
    if (data.sessionJoinPolicy !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { sessionJoinPolicy: data.sessionJoinPolicy },
        select: { id: true },
      });
    }

    return this.getMe(userId);
  }

  async regenerateFriendCode(userId: string): Promise<MeDto> {
    await this.assignFreshFriendCode(userId);
    return this.getMe(userId);
  }

  // Resolve a user-typed friend code to a live (non-deleted) user id.
  async findIdByFriendCode(rawCode: string): Promise<string | null> {
    const friendCode = normalizeFriendCode(rawCode);
    if (!friendCode) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { friendCode },
      select: { id: true, deletedAt: true },
    });

    return user && !user.deletedAt ? user.id : null;
  }

  // Retries on a unique-constraint violation (P2002) so two users minting the
  // same random code don't surface an error.
  private async assignFreshFriendCode(userId: string): Promise<string> {
    for (let attempt = 0; attempt < UserService.FRIEND_CODE_MAX_RETRIES; attempt++) {
      const friendCode = generateFriendCode();

      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: { friendCode },
          select: { id: true },
        });
        return friendCode;
      } catch (error: unknown) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException('Failed to generate a unique friend code');
  }

  async findPublicProfile(id: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_PROFILE_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findPublicProfileByUsername(username: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: PUBLIC_PROFILE_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`User with username ${username} not found`);
    }

    return user;
  }

  /**
   * People whose username or nickname holds the term, best first.
   *
   * An exact username outranks a partial one: someone typing a whole handle is naming a person,
   * not browsing.
   */
  async searchPublic(term: string, limit: number): Promise<PublicSearchHit[]> {
    const contains = { contains: term, mode: 'insensitive' } as const;

    // The page of partial matches is cut in alphabetical order and may stop short of the exact
    // handle, so that one is asked for on its own.
    const [exact, partial] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          username: { equals: term, mode: 'insensitive' },
        },
        select: PUBLIC_SEARCH_HIT_SELECT,
        orderBy: [{ username: 'asc' }],
        take: limit,
      }),
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          OR: [{ username: contains }, { nickname: contains }],
        },
        select: PUBLIC_SEARCH_HIT_SELECT,
        orderBy: [{ username: 'asc' }],
        take: limit,
      }),
    ]);

    const exactIds = new Set(exact.map((user) => user.id));
    return [...exact, ...partial.filter((user) => !exactIds.has(user.id))].slice(0, limit);
  }

  /** Writes the profile fields their owner edits: an absent field is left as it is, `null` clears it. */
  async updateMyProfile(
    id: string,
    data: {
      description?: string | null;
      nickname?: string | null;
      username?: string;
      colour?: PersonalColour;
    },
  ): Promise<PublicProfile> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data,
        select: PUBLIC_PROFILE_SELECT,
      });
    } catch (error) {
      // The handle is the only unique column this update writes, so a unique violation is a taken handle.
      if (isUniqueViolation(error)) {
        throw conflictViolation(
          `Handle ${data.username} is already taken`,
          'username',
          'USERNAME_TAKEN',
        );
      }

      throw error;
    }
  }

  async getUserRole(userId: string): Promise<RoleName> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return parseRole(user.role);
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      UserService.BCRYPT_SALT_ROUNDS,
    );

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: createUserDto.email,
          username: createUserDto.username,
          nickname: createUserDto.nickname ?? null,
          password: hashedPassword,
        },
      });
      await this.recordSignup(tx, user.id);
      return user;
    });
  }

  async createOAuthUser(email: string, username: string): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, username, password: null },
      });
      await this.recordSignup(tx, user.id);
      return user;
    });
  }

  private recordSignup(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    return this.facts.record(tx, {
      type: AnalyticsFactType.SIGNUP,
      dedupeKey: signupFactKey(),
      actorUserId: userId,
    });
  }

  async updatePassword(
    userId: string,
    plainPassword: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const hashed = await bcrypt.hash(plainPassword, UserService.BCRYPT_SALT_ROUNDS);
    await db.user.update({
      where: { id: userId },
      data: { password: hashed },
    });
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<User[]> {
    const query: Prisma.UserFindManyArgs = {};
    if (params?.skip !== undefined) {
      query.skip = params.skip;
    }
    if (params?.take !== undefined) {
      query.take = params.take;
    }
    if (params?.where !== undefined) {
      query.where = params.where;
    }
    if (params?.orderBy !== undefined) {
      query.orderBy = params.orderBy;
    }

    return this.prisma.user.findMany(query);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    return user ?? undefined;
  }
}
