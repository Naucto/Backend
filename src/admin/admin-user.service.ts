import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "@ourPrisma/prisma.service";
import { UserService } from "@user/user.service";
import { ModerationService } from "src/moderation/moderation.service";
import {
  buildOrderBy,
  paginated,
  resolvePage
} from "./admin-pagination.util";
import { StaffRole } from "./admin-roles";
import { AdminUserFilterDto } from "./dto/users/admin-user-filter.dto";
import { CreateAdminUserDto } from "./dto/users/create-admin-user.dto";
import { UpdateAdminUserDto } from "./dto/users/update-admin-user.dto";
import {
  AdminUserDetailDto,
  AdminUserListResponseDto,
  AdminUserResponseDto
} from "./dto/users/admin-user-response.dto";

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AdminUserService {
  private static readonly SORTABLE_FIELDS = [
    "id",
    "email",
    "username",
    "nickname",
    "accountStatus",
    "createdAt"
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly moderationService: ModerationService
  ) {}

  async list(filter: AdminUserFilterDto): Promise<AdminUserListResponseDto> {
    const page = resolvePage(filter);

    const where: Prisma.UserWhereInput = {};
    if (filter.email)
      where.email = { contains: filter.email, mode: "insensitive" };
    if (filter.username)
      where.username = { contains: filter.username, mode: "insensitive" };
    if (filter.nickname)
      where.nickname = { contains: filter.nickname, mode: "insensitive" };
    if (filter.accountStatus) where.accountStatus = filter.accountStatus;
    if (filter.role) where.roles = { some: { name: filter.role } };

    const orderBy = buildOrderBy<Prisma.UserOrderByWithRelationInput>(
      filter,
      AdminUserService.SORTABLE_FIELDS,
      "createdAt"
    );

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy,
        include: { roles: true }
      }),
      this.prisma.user.count({ where })
    ]);

    return paginated(users, total, page, (user) => this.toResponse(user));
  }

  async findOne(id: number): Promise<AdminUserDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });
    if (!user) throw new NotFoundException(`User with ID ${id} not found`);

    const [projectsCreated, commentsCount, reportsFiled, moderationTaken] =
      await Promise.all([
        this.prisma.project.count({ where: { userId: id } }),
        this.prisma.comment.count({ where: { authorId: id } }),
        this.prisma.report.count({ where: { reporterId: id } }),
        this.prisma.moderationAction.count({ where: { actorId: id } })
      ]);

    const base = this.toResponse(user);
    return {
      ...base,
      projectsCreatedCount: projectsCreated,
      commentsCount,
      reportsFiledCount: reportsFiled,
      moderationActionsTakenCount: moderationTaken
    };
  }

  async createStaff(
    dto: CreateAdminUserDto,
    actorId: number
  ): Promise<AdminUserResponseDto> {
    const [existingByEmail, existingByUsername] = await Promise.all([
      this.prisma.user.findUnique({ where: { email: dto.email } }),
      this.prisma.user.findUnique({ where: { username: dto.username } })
    ]);
    if (existingByEmail) {
      throw new BadRequestException("Email already in use");
    }
    if (existingByUsername) {
      throw new BadRequestException("Username already in use");
    }

    const created = await this.userService.create({
      email: dto.email,
      username: dto.username,
      ...(dto.nickname ? { nickname: dto.nickname } : {}),
      password: dto.password,
      roles: dto.roles
    });

    const withRoles = await this.prisma.user.findUnique({
      where: { id: created.id },
      include: { roles: true }
    });

    await this.moderationService.recordStaffCreation(
      created.id,
      actorId,
      withRoles,
      `Staff account created with roles: ${dto.roles.join(", ")}`
    );

    return this.toResponse(withRoles!);
  }

  async update(
    id: number,
    dto: UpdateAdminUserDto,
    actorId: number
  ): Promise<AdminUserResponseDto> {
    const before = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });
    if (!before) throw new NotFoundException(`User with ID ${id} not found`);

    if (dto.roles) {
      const currentRoleNames = before.roles.map((role) => role.name);
      const toConnect = dto.roles.filter(
        (name) => !currentRoleNames.includes(name)
      );
      const toDisconnect = currentRoleNames.filter(
        (name) => !dto.roles!.includes(name)
      );
      if (toConnect.length || toDisconnect.length) {
        await this.moderationService.updateUserRoles(
          id,
          actorId,
          toConnect,
          toDisconnect,
          dto.reason
        );
      }
    }

    const patch: {
      email?: string;
      username?: string;
      nickname?: string | null;
    } = {};
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.username !== undefined) patch.username = dto.username;
    if (dto.nickname !== undefined) patch.nickname = dto.nickname;
    if (Object.keys(patch).length) {
      await this.moderationService.editUser(id, actorId, patch, dto.reason);
    }

    return this.findOne(id);
  }

  async setStatus(
    id: number,
    actorId: number,
    accountStatus: "ACTIVE" | "SUSPENDED" | "BANNED",
    reason?: string,
    reportId?: number
  ): Promise<AdminUserResponseDto> {
    await this.moderationService.setUserStatus(
      id,
      actorId,
      accountStatus,
      reason ?? null,
      reportId ?? null
    );
    return this.findOne(id);
  }

  /**
   * Grants a staff role. Parameterised rather than one endpoint per role, so
   * adding a role never means adding a second copy of this flow.
   */
  async grantRole(
    id: number,
    actorId: number,
    role: StaffRole,
    reason?: string
  ): Promise<AdminUserResponseDto> {
    const current = await this.getRoleNames(id);
    if (current.includes(role)) {
      throw new BadRequestException(`User already has the ${role} role`);
    }

    await this.ensureRoleSeeded(role);
    await this.moderationService.updateUserRoles(
      id,
      actorId,
      [role],
      [],
      reason ?? `Granted ${role} access`
    );

    return this.findOne(id);
  }

  async revokeRole(
    id: number,
    actorId: number,
    role: StaffRole,
    reason?: string
  ): Promise<AdminUserResponseDto> {
    // Revoking your own Admin locks you out of every admin-only page. The last
    // -admin guard in ModerationService does not catch this while other admins
    // exist, so refuse it here and let another admin do it.
    if (id === actorId && role === "Admin") {
      throw new BadRequestException(
        "You cannot revoke your own Admin role. Ask another admin to do it."
      );
    }

    const current = await this.getRoleNames(id);
    if (!current.includes(role)) {
      throw new BadRequestException(`User does not have the ${role} role`);
    }

    await this.moderationService.updateUserRoles(
      id,
      actorId,
      [],
      [role],
      reason ?? `Revoked ${role} access`
    );

    return this.findOne(id);
  }

  private async getRoleNames(id: number): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { roles: { select: { name: true } } }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user.roles.map((role) => role.name);
  }

  async resetPassword(
    id: number,
    actorId: number,
    newPassword: string,
    reason?: string
  ): Promise<{ success: true }> {
    const hashed = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await this.moderationService.resetUserPassword(
      id,
      actorId,
      hashed,
      reason ?? null
    );
    return { success: true };
  }

  async hardDelete(
    id: number,
    actorId: number,
    reason?: string
  ): Promise<{ success: true }> {
    if (id === actorId) {
      throw new BadRequestException("You cannot delete your own account");
    }
    await this.moderationService.hardDeleteUser(id, actorId, reason ?? null);
    return { success: true };
  }

  private async ensureRoleSeeded(name: string): Promise<void> {
    await this.prisma.role.upsert({
      where: { name },
      update: {},
      create: { name }
    });
  }

  private toResponse(
    user: {
      id: number;
      email: string;
      username: string;
      nickname: string | null;
      accountStatus: "ACTIVE" | "SUSPENDED" | "BANNED";
      createdAt: Date;
      moderationReason: string | null;
      moderatedAt: Date | null;
      moderatedById: number | null;
    } & { roles: { name: string }[] }
  ): AdminUserResponseDto {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      nickname: user.nickname,
      accountStatus: user.accountStatus,
      roles: user.roles.map((role) => role.name),
      createdAt: user.createdAt.toISOString(),
      moderationReason: user.moderationReason,
      moderatedAt: user.moderatedAt?.toISOString() ?? null,
      moderatedById: user.moderatedById
    };
  }
}
