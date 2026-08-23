import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "@ourPrisma/prisma.service";
import { UserService } from "@user/user.service";
import { ModerationService } from "src/moderation/moderation.service";
import { StaffRole } from "./admin-roles";
import { CreateAdminUserDto } from "./dto/users/create-admin-user.dto";
import {
  AdminUserResponseDto
} from "./dto/users/admin-user-response.dto";

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly moderationService: ModerationService
  ) {}

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

  /**
   * The user as the panel renders it after a moderation verb.
   *
   * Listing and detail reads live on `/users` now; this is only the echo the
   * suspend/ban/role endpoints return, so it stays private.
   */
  private async findOne(id: number): Promise<AdminUserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { roles: true }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return this.toResponse(user);
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
    };
  }
}
