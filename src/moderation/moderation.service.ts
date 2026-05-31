import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import {
  AccountStatus,
  AnalyticsEventType,
  ModerationActionType,
  ModerationTargetType,
  Prisma,
  ProjectStatus,
  ReportStatus,
  ReportTargetType
} from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AnalyticsService } from "src/analytics/analytics.service";
import { CreateReportDto } from "./dto/create-report.dto";

type AuditInput = {
  actorId?: number | null;
  targetType: ModerationTargetType;
  targetId: number;
  action: ModerationActionType;
  reason?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reportId?: number | null;
};

type ProjectEditableFields = {
  name?: string;
  shortDesc?: string;
  longDesc?: string | null;
  publishedName?: string | null;
  publishedShortDesc?: string | null;
  publishedLongDesc?: string | null;
  tags?: string[];
  publishedTags?: string[];
  iconUrl?: string | null;
  monetization?: "NONE" | "ADS" | "PAID";
  price?: number | null;
  hiddenReason?: string | null;
};

type UserEditableFields = {
  email?: string;
  username?: string;
  nickname?: string | null;
  moderationReason?: string | null;
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
    @Optional()
    @Inject(AnalyticsService)
    private readonly analyticsService?: AnalyticsService
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
    await this.assertTargetExists(dto.targetType, dto.targetId);

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
    await this.prisma.moderationAction.create({
      data: {
        actorId: input.actorId ?? null,
        targetType: input.targetType,
        targetId: input.targetId,
        action: input.action,
        reason: input.reason ?? null,
        before: input.before ?? Prisma.JsonNull,
        after: input.after ?? Prisma.JsonNull,
        reportId: input.reportId ?? null
      }
    });
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  // ─── Users ────────────────────────────────────────────────────────────────

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
        id: true,
        accountStatus: true,
        moderationReason: true,
        moderatedAt: true,
        moderatedById: true
      }
    });

    if (!before) {
      throw new NotFoundException(`User with ID ${targetId} not found`);
    }

    const after = await this.prisma.user.update({
      where: { id: targetId },
      data: {
        accountStatus,
        moderationReason: reason ?? null,
        moderatedAt: new Date(),
        moderatedById: actorId
      },
      select: {
        id: true,
        accountStatus: true,
        moderationReason: true,
        moderatedAt: true,
        moderatedById: true
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
      before: this.toJson(before),
      after: this.toJson(after),
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
      include: { roles: true }
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
      include: { roles: true }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action: ModerationActionType.UPDATE_ROLES,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after)
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
        moderationReason: true
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
        moderationReason: true
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.USER,
      targetId,
      action: ModerationActionType.EDIT_USER,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after)
    });
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
      include: { roles: true }
    });

    if (!before) {
      throw new NotFoundException(`User with ID ${targetId} not found`);
    }

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
      before: this.toJson(before)
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
      after: this.toJson(snapshot)
    });
  }

  // ─── Projects ─────────────────────────────────────────────────────────────

  async hideProject(
    targetId: number,
    actorId: number | null,
    reason?: string | null,
    reportId?: number | null
  ): Promise<void> {
    const before = await this.prisma.project.findUnique({
      where: { id: targetId }
    });

    if (!before) {
      throw new NotFoundException(`Project with ID ${targetId} not found`);
    }

    const after = await this.prisma.project.update({
      where: { id: targetId },
      data: {
        hidden: true,
        hiddenReason: reason ?? null,
        hiddenAt: new Date(),
        hiddenById: actorId,
        status: ProjectStatus.ARCHIVED
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.PROJECT,
      targetId,
      action: ModerationActionType.HIDE_PROJECT,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after),
      reportId: reportId ?? null
    });
  }

  async restoreProject(
    targetId: number,
    actorId: number | null,
    reason?: string | null,
    reportId?: number | null
  ): Promise<void> {
    const before = await this.prisma.project.findUnique({
      where: { id: targetId }
    });

    if (!before) {
      throw new NotFoundException(`Project with ID ${targetId} not found`);
    }

    const after = await this.prisma.project.update({
      where: { id: targetId },
      data: {
        hidden: false,
        hiddenReason: null,
        hiddenAt: null,
        hiddenById: null
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.PROJECT,
      targetId,
      action: ModerationActionType.RESTORE_PROJECT,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after),
      reportId: reportId ?? null
    });
  }

  async unpublishProject(
    targetId: number,
    actorId: number | null,
    reason?: string | null,
    reportId?: number | null
  ): Promise<void> {
    const before = await this.prisma.project.findUnique({
      where: { id: targetId }
    });

    if (!before) {
      throw new NotFoundException(`Project with ID ${targetId} not found`);
    }

    const after = await this.prisma.project.update({
      where: { id: targetId },
      data: { status: ProjectStatus.IN_PROGRESS }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.PROJECT,
      targetId,
      action: ModerationActionType.UNPUBLISH_PROJECT,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after),
      reportId: reportId ?? null
    });

    await this.analyticsService?.record(AnalyticsEventType.PROJECT_UNPUBLISHED, {
      projectId: targetId,
      userId: actorId ?? null
    });
  }

  async editProject(
    targetId: number,
    actorId: number | null,
    patch: ProjectEditableFields,
    reason?: string | null
  ): Promise<void> {
    const before = await this.prisma.project.findUnique({
      where: { id: targetId }
    });

    if (!before) {
      throw new NotFoundException(`Project with ID ${targetId} not found`);
    }

    const after = await this.prisma.project.update({
      where: { id: targetId },
      data: patch
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.PROJECT,
      targetId,
      action: ModerationActionType.EDIT_PROJECT,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after)
    });
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async hideComment(
    targetId: number,
    actorId: number | null,
    reason?: string | null,
    reportId?: number | null
  ): Promise<void> {
    const before = await this.prisma.comment.findUnique({
      where: { id: targetId }
    });

    if (!before) {
      throw new NotFoundException(`Comment with ID ${targetId} not found`);
    }

    const after = await this.prisma.comment.update({
      where: { id: targetId },
      data: {
        hidden: true,
        hiddenReason: reason ?? null,
        hiddenAt: new Date(),
        hiddenById: actorId
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.COMMENT,
      targetId,
      action: ModerationActionType.HIDE_COMMENT,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after),
      reportId: reportId ?? null
    });
  }

  async restoreComment(
    targetId: number,
    actorId: number | null,
    reason?: string | null,
    reportId?: number | null
  ): Promise<void> {
    const before = await this.prisma.comment.findUnique({
      where: { id: targetId }
    });

    if (!before) {
      throw new NotFoundException(`Comment with ID ${targetId} not found`);
    }

    const after = await this.prisma.comment.update({
      where: { id: targetId },
      data: {
        hidden: false,
        hiddenReason: null,
        hiddenAt: null,
        hiddenById: null
      }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.COMMENT,
      targetId,
      action: ModerationActionType.RESTORE_COMMENT,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after),
      reportId: reportId ?? null
    });
  }

  async editComment(
    targetId: number,
    actorId: number | null,
    newContent: string,
    reason?: string | null
  ): Promise<void> {
    const before = await this.prisma.comment.findUnique({
      where: { id: targetId }
    });

    if (!before) {
      throw new NotFoundException(`Comment with ID ${targetId} not found`);
    }

    const after = await this.prisma.comment.update({
      where: { id: targetId },
      data: { content: newContent }
    });

    await this.audit({
      actorId,
      targetType: ModerationTargetType.COMMENT,
      targetId,
      action: ModerationActionType.EDIT_COMMENT,
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after)
    });
  }

  // ─── Reports ──────────────────────────────────────────────────────────────

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
      before: this.toJson(before),
      after: this.toJson(after),
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
      before: this.toJson(before),
      after: this.toJson(after),
      reportId
    });
  }

  // ─── Roles ────────────────────────────────────────────────────────────────

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
      after: this.toJson(snapshot)
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
      before: this.toJson(before),
      after: this.toJson(after)
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
      before: this.toJson(snapshot)
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

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
    targetId: number
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
      return;
    }

    if (targetType === "PROJECT") {
      const exists = await this.prisma.project.findUnique({
        where: { id: targetId },
        select: { id: true }
      });
      if (!exists) throw new NotFoundException("Reported project not found");
      return;
    }

    const exists = await this.prisma.comment.findUnique({
      where: { id: targetId },
      select: { id: true }
    });
    if (!exists) throw new NotFoundException("Reported comment not found");
  }
}
