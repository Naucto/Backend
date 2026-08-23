import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AuditService } from "src/moderation/audit";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { User, Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";

import { Role } from "@prisma/client";

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}
  private static readonly BCRYPT_SALT_ROUNDS = 10;

  async findPublicProfile(id: number): Promise<{
    id: number;
    username: string;
    nickname: string | null;
    description: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        username: true,
        nickname: true,
        description: true
      }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async findPublicProfileByUsername(username: string): Promise<{
    id: number;
    username: string;
    nickname: string | null;
    description: string | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        nickname: true,
        description: true
      }
    });

    if (!user) {
      throw new NotFoundException(`User with username ${username} not found`);
    }

    return user;
  }

  async updateMyProfile(
    id: number,
    data: { description?: string | null }
  ): Promise<{
    id: number;
    username: string;
    description: string | null;
  }> {
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
        id: true,
        username: true,
        description: true
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

  /**
   * A user with the fields moderation needs: roles, and the counts the staff
   * detail view shows. Same resource as {@link findOne}, just the staff view of
   * it -- which is why it is here rather than behind a parallel admin service.
   */
  async findOneForModeration(id: number): Promise<User & {
    roles: { name: string }[];
    projectsCreatedCount: number;
    commentsCount: number;
    reportsFiledCount: number;
    moderationActionsTakenCount: number;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const [projectsCreated, comments, reportsFiled, actionsTaken] =
      await Promise.all([
        this.prisma.project.count({ where: { userId: id } }),
        this.prisma.comment.count({ where: { authorId: id } }),
        this.prisma.report.count({ where: { reporterId: id } }),
        this.auditService.countByActor(id)
      ]);

    return {
      ...user,
      projectsCreatedCount: projectsCreated,
      commentsCount: comments,
      reportsFiledCount: reportsFiled,
      moderationActionsTakenCount: actionsTaken
    };
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      UserService.BCRYPT_SALT_ROUNDS
    );

    const rolesToAssign = createUserDto.roles?.length
      ? await this.findRolesByNames(createUserDto.roles)
      : [];

    return this.prisma.user.create({
      data: {
        email: createUserDto.email,
        username: createUserDto.username,
        nickname: createUserDto.nickname ?? null,
        password: hashedPassword,
        roles: {
          connect: rolesToAssign.map((role) => ({ id: role.id }))
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
    include?: Prisma.UserInclude;
  }): Promise<User[]> {
    const query: Prisma.UserFindManyArgs = {};
    if (params?.skip !== undefined) query.skip = params.skip;
    if (params?.take !== undefined) query.take = params.take;
    if (params?.where !== undefined) query.where = params.where;
    if (params?.orderBy !== undefined) query.orderBy = params.orderBy;
    if (params?.include !== undefined) query.include = params.include;

    const users = await this.prisma.user.findMany(query);

    // `GET /users` is open to any authenticated caller, so the rows must never
    // carry the bcrypt hash. Blanked here rather than by a `select` so callers
    // keep getting the full `User` shape (and their `include`s) as before.
    return users.map((user) => ({ ...user, password: null }));
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
