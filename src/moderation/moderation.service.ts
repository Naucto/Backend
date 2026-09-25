import { Actor } from "@auth/actor";
import { Permission } from "@auth/permissions";
import { UpdateUserDto } from "@user/dto/update-user.dto";
import { UserDto } from "@auth/dto/user.dto";
import { stripPassword } from "@auth/auth.utils";
import * as bcrypt from "bcryptjs";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AccountStatus,
  ModerationActionType,
  ModerationTargetType,
  ReportStatus,
  ReportTargetType
} from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { AuditService } from "./audit";

type AuditInput = {
  actorId?: number | null;
  targetType: ModerationTargetType;
  targetId: number;
  action: ModerationActionType;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  reportId?: number | null;
};

type UserEditableFields = {
  email?: string;
  username?: string;
  nickname?: string | null;
};

const TERMINAL_REPORT_STATUSES = new Set<ReportStatus>([
  ReportStatus.RESOLVED,
  ReportStatus.DISMISSED
]);

const ALLOWED_REPORT_TRANSITIONS: Record<ReportStatus, ReportStatus[]> = {
  [ReportStatus.OPEN]: [
    ReportStatus.IN_REVIEW,
    ReportStatus.RESOLVED,
    ReportStatus.DISMISSED
  ],
  [ReportStatus.IN_REVIEW]: [
    ReportStatus.OPEN,
    ReportStatus.RESOLVED,
    ReportStatus.DISMISSED
  ],
  [ReportStatus.RESOLVED]: [],
  [ReportStatus.DISMISSED]: []
};

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService
  ) {}

  async createReport(
    reporterId: number,
    dto: CreateReportDto
  ): Promise<{
    id: number;
    targetType: ReportTargetType;
    targetId: number;
    reporterId: number;
    reason: string;
    details: string | null;
    status: ReportStatus;
    createdAt: Date;
  }> {
    await this.assertTargetExists(dto.targetType, dto.targetId, reporterId);

    return this.prisma.report.create({
      data: {
        targetType: dto.targetType,
        targetId: dto.targetId,
        reporterId,
        reason: dto.reason,
        details: dto.details ?? null
      },
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reporterId: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true
      }
    });
  }

  async audit(input: AuditInput): Promise<void> {
    await this.auditService.record({
      ref: { type: input.targetType, id: input.targetId },
      actor: input.actorId ?? null,
      action: input.action,
      reason: input.reason ?? null,
      before: input.before,
      after: input.after,
      reportId: input.reportId ?? null
    });
  }

  private async assertMayModerateAccount(
    targetId: number,
    actorId: number | null
  ): Promise<void> {
    if (actorId === null) {
      return;
    }

    if (targetId === actorId) {
      throw new BadRequestException(
        "You cannot apply a moderation action to your own account"
      );
    }

    const [actor, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: actorId },
        select: { roles: { select: { name: true, permissions: true } } }
      }),
      this.prisma.user.findUnique({
        where: { id: targetId },
        select: { roles: { select: { name: true, permissions: true } } }
      })
    ]);

    if (!actor || !target) {
      return;
    }

    const actorRank = Actor.from({ id: actorId, roles: actor.roles }).rank;
    const targetRank = Actor.from({ id: targetId, roles: target.roles }).rank;

    if (targetRank === 0) {
      return;
    }

    if (actorRank <= targetRank) {
      throw new ForbiddenException(
        actorRank === 1
          ? "Moderators cannot moderate other staff accounts"
          : "You cannot moderate an account of equal or higher rank"
      );
    }
  }

  private async assertAdminsRemainReachable(
    targetId: number,
    nextStatus: AccountStatus
  ): Promise<void> {
    if (nextStatus === AccountStatus.ACTIVE) {
      return;
    }

    const remaining = await this.prisma.user.count({
      where: {
        id: { not: targetId },
        accountStatus: AccountStatus.ACTIVE,
        roles: { some: { name: "Admin" } }
      }
    });

    if (remaining === 0) {
      throw new BadRequestException(
        "This would leave no active admin; promote someone else first"
      );
    }
  }

  async setUserStatus(
    targetId: number,
    actorId: number | null,
    accountStatus: AccountStatus,
    reason?: string | null,
    reportId?: number | null
  ): Promise<void> {
    const before = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        // Who suspended them, when and why is the audit entry's job now.
        id: true,
        accountStatus: true
      }
    });

    if (!before) {
      throw new NotFoundException(`User with ID ${targetId} not found`);
    }

    await this.assertMayModerateAccount(targetId, actorId);
    await this.assertAdminsRemainReachable(targetId, accountStatus);

    const after = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        accountStatus
      },
      select: {
        id: true,
        accountStatus: true
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action:
        accountStatus === AccountStatus.BANNED
          ? ModerationActionType.BAN_USER
          : accountStatus === AccountStatus.SUSPENDED
            ? ModerationActionType.SUSPEND_USER
            : ModerationActionType.RESTORE_USER,
      reason: reason ?? null,
      before,
      after,
      reportId: reportId ?? null
    });
  }

  async updateUserRoles(
    targetId: number,
    actorId: number | null,
    rolesToConnect: string[],
    rolesToDisconnect: string[],
    reason?: string | null
  ): Promise<void> {
    const before = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, email: true, accountStatus: true, roles: true }
    });

    if (!before) {
      throw new NotFoundException(`User with ID ${targetId} not found`);
    }

    if (rolesToDisconnect.length > 0) {
      await this.assertNotLastAdmin(targetId, rolesToDisconnect, before.roles);
    }

    const connectRoles = await this.prisma.role.findMany({
      where: { name: { in: rolesToConnect } }
    });
    const disconnectRoles = await this.prisma.role.findMany({
      where: { name: { in: rolesToDisconnect } }
    });

    await this.prisma.user.update({
      where: { id: targetId },
      data: {
        roles: {
          connect: connectRoles.map((role) => ({ id: role.id })),
          disconnect: disconnectRoles.map((role) => ({ id: role.id }))
        }
      }
    });

    const after = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, email: true, accountStatus: true, roles: true }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action: ModerationActionType.UPDATE_ROLES,
      reason: reason ?? null,
      before,
      after
    });
  }

  async editUser(
    targetId: number,
    actorId: number | null,
    patch: UserEditableFields,
    reason?: string | null
  ): Promise<void> {
    const before = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
      }
    });

    if (!before) {
      throw new NotFoundException(`User with ID ${targetId} not found`);
    }

    const after = await this.prisma.user.update({
      where: { id: targetId },
      data: patch,
      select: {
        id: true,
        email: true,
        username: true,
        nickname: true,
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action: ModerationActionType.EDIT_USER,
      reason: reason ?? null,
      before,
      after
    });
  }

  async updateUser(id: number, actor: Actor, dto: UpdateUserDto): Promise<UserDto> {
    if (!actor.can(Permission.MANAGE_USERS)) {
      throw new ForbiddenException("Managing users requires permission");
    }
    if (dto.roles && !actor.can(Permission.MANAGE_ROLES)) {
      throw new ForbiddenException("Managing roles requires permission");
    }
    await this.assertMayModerateAccount(id, actor.id);
    const { password, roles, ...profile } = dto;
    if (Object.keys(profile).length) await this.editUser(id, actor.id, profile);
    if (password !== undefined) {
      await this.resetUserPassword(id, actor.id, await bcrypt.hash(password, 10));
    }
    if (roles) await this.updateUserRoles(id, actor.id, roles, []);
    const user = await this.prisma.user.findUnique({ where: { id }, include: { roles: true } });
    if (!user) throw new NotFoundException(`User with ID ${id} not found`);
    return stripPassword(user);
  }

  async resetUserPassword(
    targetId: number,
    actorId: number | null,
    hashedPassword: string,
    reason?: string | null
  ): Promise<void> {
    const exists = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true }
    });
    if (!exists) {
      throw new NotFoundException(`User with ID ${targetId} not found`);
    }

    // Resetting a peer's password hands you their account.
    await this.assertMayModerateAccount(targetId, actorId);

    await this.prisma.user.update({
      where: { id: targetId },
      data: { password: hashedPassword }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action: ModerationActionType.RESET_PASSWORD,
      reason: reason ?? null
    });
  }

  async hardDeleteUser(
    targetId: number,
    actorId: number | null,
    reason?: string | null
  ): Promise<void> {
    const before = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, email: true, accountStatus: true, roles: true }
    });

    if (!before) {
      throw new NotFoundException(`User with ID ${targetId} not found`);
    }

    await this.assertMayModerateAccount(targetId, actorId);

    await this.assertNotLastAdmin(
      targetId,
      before.roles.map((role) => role.name),
      before.roles
    );

    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action: ModerationActionType.HARD_DELETE_USER,
      reason: reason ?? null,
      before
    });

    await this.prisma.user.delete({ where: { id: targetId } });
  }

  async recordStaffCreation(
    targetId: number,
    actorId: number | null,
    snapshot: unknown,
    reason?: string | null
  ): Promise<void> {
    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action: ModerationActionType.CREATE_STAFF_USER,
      reason: reason ?? null,
      after: snapshot
    });
  }

  async setReportStatus(
    reportId: number,
    actorId: number | null,
    newStatus: ReportStatus,
    resolutionNote?: string | null
  ): Promise<void> {
    const before = await this.prisma.report.findUnique({
      where: { id: reportId }
    });

    if (!before) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    if (before.status === newStatus) {
      return;
    }

    const allowed = ALLOWED_REPORT_TRANSITIONS[before.status];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot transition report from ${before.status} to ${newStatus}`
      );
    }

    const isTerminal = TERMINAL_REPORT_STATUSES.has(newStatus);

    const after = await this.prisma.report.update({
      where: { id: reportId },
      data: {
        status: newStatus,
        resolutionNote: resolutionNote ?? before.resolutionNote,
        resolvedAt: isTerminal ? new Date() : null,
        resolvedById: isTerminal ? actorId : null
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.REPORT,
      targetId: reportId,
      action:
        newStatus === ReportStatus.RESOLVED
          ? ModerationActionType.RESOLVE_REPORT
          : newStatus === ReportStatus.IN_REVIEW
            ? ModerationActionType.REVIEW_REPORT
            : newStatus === ReportStatus.DISMISSED
              ? ModerationActionType.DISMISS_REPORT
              : ModerationActionType.UPDATE_REPORT,
      reason: resolutionNote ?? null,
      before,
      after,
      reportId
    });
  }

  async updateReportNote(
    reportId: number,
    actorId: number | null,
    note: string | null
  ): Promise<void> {
    const before = await this.prisma.report.findUnique({
      where: { id: reportId }
    });

    if (!before) {
      throw new NotFoundException(`Report with ID ${reportId} not found`);
    }

    const after = await this.prisma.report.update({
      where: { id: reportId },
      data: { resolutionNote: note }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.REPORT,
      targetId: reportId,
      action: ModerationActionType.UPDATE_REPORT,
      reason: note ?? null,
      before,
      after,
      reportId
    });
  }

  async recordRoleCreated(
    roleId: number,
    actorId: number | null,
    snapshot: unknown,
    reason?: string | null
  ): Promise<void> {
    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId: roleId,
      action: ModerationActionType.CREATE_ROLE,
      reason: reason ?? null,
      after: snapshot
    });
  }

  async recordRoleRenamed(
    roleId: number,
    actorId: number | null,
    before: unknown,
    after: unknown,
    reason?: string | null
  ): Promise<void> {
    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId: roleId,
      action: ModerationActionType.RENAME_ROLE,
      reason: reason ?? null,
      before,
      after
    });
  }

  async recordRoleDeleted(
    roleId: number,
    actorId: number | null,
    snapshot: unknown,
    reason?: string | null
  ): Promise<void> {
    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId: roleId,
      action: ModerationActionType.DELETE_ROLE,
      reason: reason ?? null,
      before: snapshot
    });
  }

  private async assertNotLastAdmin(
    targetUserId: number,
    rolesBeingRemoved: string[],
    currentRoles: { name: string }[]
  ): Promise<void> {
    const removingAdmin =
      rolesBeingRemoved.includes("Admin") &&
      currentRoles.some((role) => role.name === "Admin");

    if (!removingAdmin) return;

    const adminCount = await this.prisma.user.count({
      where: {
        roles: { some: { name: "Admin" } }
      }
    });

    if (adminCount <= 1) {
      throw new BadRequestException(
        `Cannot remove Admin role from user ${targetUserId}: at least one Admin must remain`
      );
    }
  }

  private async assertTargetExists(
    targetType: ReportTargetType,
    targetId: number,
    reporterId: number
  ): Promise<void> {
    if (targetId < 1) {
      throw new BadRequestException("Invalid report target");
    }

    if (targetType === "USER") {
      const exists = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true }
      });
      if (!exists) throw new NotFoundException("Reported user not found");
      if (exists.id === reporterId) {
        throw new BadRequestException("You cannot report your own content");
      }
      return;
    }

    if (targetType === "PROJECT") {
      const exists = await this.prisma.project.findUnique({
        where: { id: targetId },
        select: { id: true, userId: true }
      });
      if (!exists) throw new NotFoundException("Reported project not found");
      if (exists.userId === reporterId) {
        throw new BadRequestException("You cannot report your own content");
      }
      return;
    }

    const exists = await this.prisma.comment.findUnique({
      where: { id: targetId },
      select: { id: true, authorId: true }
    });
    if (!exists) throw new NotFoundException("Reported comment not found");
    if (exists.authorId === reporterId) {
      throw new BadRequestException("You cannot report your own content");
    }
  }

}
