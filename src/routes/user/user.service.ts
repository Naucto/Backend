import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { Prisma, Role, SessionJoinPolicy, User } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { MeDto } from "./dto/me.dto";
import { generateFriendCode, normalizeFriendCode } from "./friend-code.util";

/**
 * What anyone may see of a person. `createdAt` is here because the profile header shows the year
 * they joined — a fact about a public profile, not an account detail.
 */
const PUBLIC_PROFILE_SELECT = {
  id: true,
  username: true,
  nickname: true,
  description: true,
  createdAt: true
} as const;

export type PublicProfile = {
  id: number;
  username: string;
  nickname: string | null;
  description: string | null;
  createdAt: Date;
};

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}
  private static readonly BCRYPT_SALT_ROUNDS = 10;
  private static readonly FRIEND_CODE_MAX_RETRIES = 5;

  // --------------------------------------------------------------------------
  // Account settings (/users/me)
  // --------------------------------------------------------------------------

  async getMe(userId: number): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { friendCode: true, sessionJoinPolicy: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Lazily mint the code so pre-existing accounts get one on first read.
    const friendCode =
      user.friendCode ?? (await this.assignFreshFriendCode(userId));

    return { friendCode, sessionJoinPolicy: user.sessionJoinPolicy };
  }

  async updateMe(
    userId: number,
    data: { sessionJoinPolicy?: SessionJoinPolicy }
  ): Promise<MeDto> {
    if (data.sessionJoinPolicy !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { sessionJoinPolicy: data.sessionJoinPolicy },
        select: { id: true }
      });
    }

    return this.getMe(userId);
  }

  async regenerateFriendCode(userId: number): Promise<MeDto> {
    await this.assignFreshFriendCode(userId);
    return this.getMe(userId);
  }

  // Resolve a user-typed friend code to a live (non-deleted) user id.
  async findIdByFriendCode(rawCode: string): Promise<number | null> {
    const friendCode = normalizeFriendCode(rawCode);
    if (!friendCode) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { friendCode },
      select: { id: true, deletedAt: true }
    });

    return user && !user.deletedAt ? user.id : null;
  }

  // Retries on a unique-constraint violation (P2002) so two users minting the
  // same random code don't surface an error.
  private async assignFreshFriendCode(userId: number): Promise<string> {
    for (
      let attempt = 0;
      attempt < UserService.FRIEND_CODE_MAX_RETRIES;
      attempt++
    ) {
      const friendCode = generateFriendCode();

      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: { friendCode },
          select: { id: true }
        });
        return friendCode;
      } catch (error: unknown) {
        if (!this.isFriendCodeConflict(error)) {
          throw error;
        }
      }
    }

    throw new ConflictException("Failed to generate a unique friend code");
  }

  private isFriendCodeConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      JSON.stringify(error.meta?.["target"] ?? "").includes("friendCode")
    );
  }

  // --------------------------------------------------------------------------

  async findPublicProfile(id: number): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: PUBLIC_PROFILE_SELECT
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findPublicProfileByUsername(username: string): Promise<PublicProfile> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: PUBLIC_PROFILE_SELECT
    });

    if (!user) {
      throw new NotFoundException(`User with username ${username} not found`);
    }

    return user;
  }

  async updateMyProfile(
    id: number,
    data: { description?: string | null }
  ): Promise<PublicProfile> {
    const nextProfileText = data.description;

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        ...(nextProfileText !== undefined
          ? {
            description: nextProfileText
          }
          : {})
      },
      select: {
        ...PUBLIC_PROFILE_SELECT
      }
    });

    return updatedUser;
  }

  async findRolesByNames(names: string[]): Promise<Role[]> {
    return this.prisma.role.findMany({
      where: {
        name: { in: names }
      }
    });
  }

  async getUserRoles(userId: number): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user.roles.map((role) => role.name);
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      UserService.BCRYPT_SALT_ROUNDS
    );

    const rolesToAssign: { id: number }[] = [];

    return this.prisma.user.create({
      data: {
        email: createUserDto.email,
        username: createUserDto.username,
        nickname: createUserDto.nickname ?? null,
        password: hashedPassword,
        roles: {
          connect: rolesToAssign
        }
      }
    });
  }

  async createOAuthUser(email: string, username: string): Promise<User> {
    return this.prisma.user.create({
      data: { email, username, password: null, roles: { connect: [] } }
    });
  }

  async updatePassword(userId: number, plainPassword: string): Promise<void> {
    const hashed = await bcrypt.hash(
      plainPassword,
      UserService.BCRYPT_SALT_ROUNDS
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed }
    });
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<User[]> {
    const query: Prisma.UserFindManyArgs = {};
    if (params?.skip !== undefined) query.skip = params.skip;
    if (params?.take !== undefined) query.take = params.take;
    if (params?.where !== undefined) query.where = params.where;
    if (params?.orderBy !== undefined) query.orderBy = params.orderBy;

    return this.prisma.user.findMany(query);
  }

  async count(where?: Prisma.UserWhereInput): Promise<number> {
    const countArgs: Prisma.UserCountArgs = {};

    if (where !== undefined) countArgs.where = where;
    return this.prisma.user.count(countArgs);
  }

  async findOne<ComplexFieldsT>(
    id: number,
    whatElse: Record<string, boolean> = {}
  ): Promise<User & ComplexFieldsT> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: whatElse
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user as User & ComplexFieldsT;
  }

  async update(id: number, updateUserDto: UpdateUserDto): Promise<User> {
    const { roles, ...rest } = updateUserDto;

    const data: Prisma.UserUpdateInput = {
      ...rest,
      ...(roles
        ? { roles: { connect: roles.map((roleName) => ({ name: roleName })) } }
        : {})
    };

    if (updateUserDto.password) {
      data.password = await bcrypt.hash(
        updateUserDto.password,
        UserService.BCRYPT_SALT_ROUNDS
      );
    }

    try {
      return await this.prisma.user.update({
        where: { id },
        data
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }
      throw error;
    }
  }

  async remove(id: number): Promise<User> {
    return this.prisma.user.delete({
      where: { id }
    });
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { email }
    });
    return user ?? undefined;
  }
}
