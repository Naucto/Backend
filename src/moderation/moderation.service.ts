import {
  BadRequestException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import {
  AccountStatus,
  ModerationActionType,
  ModerationTargetType,
  Prisma,
  ReportTargetType
} from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
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

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

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
    status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
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
      targetType: "USER",
      targetId,
      action: accountStatus === "BANNED"
        ? "BAN_USER"
        : accountStatus === "SUSPENDED"
          ? "SUSPEND_USER"
          : "RESTORE_USER",
      reason: reason ?? null,
      before: this.toJson(before),
      after: this.toJson(after),
      reportId: reportId ?? null
    });
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
