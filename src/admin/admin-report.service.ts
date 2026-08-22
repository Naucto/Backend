import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ReportStatus } from "@prisma/client";
import { PrismaService } from "@ourPrisma/prisma.service";
import { ModerationService } from "src/moderation/moderation.service";
import { TargetLinkService } from "./services/target-link.service";
import {
  buildMeta,
  buildOrderBy,
  resolvePage
} from "./admin-pagination.util";
import { AdminReportFilterDto } from "./dto/reports/admin-report-filter.dto";
import {
  AdminReportDetailDto,
  AdminReportListResponseDto,
  AdminReportResponseDto
} from "./dto/reports/admin-report-response.dto";

type ReportWithRels = Prisma.ReportGetPayload<{
  include: { reporter: { select: { username: true } } };
}>;

@Injectable()
export class AdminReportService {
  private static readonly SORTABLE_FIELDS = [
    "id",
    "status",
    "targetType",
    "createdAt",
    "reviewedAt"
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
    private readonly targetLinks: TargetLinkService
  ) {}

  async list(filter: AdminReportFilterDto): Promise<AdminReportListResponseDto> {
    const page = resolvePage(filter);

    const where: Prisma.ReportWhereInput = {};
    if (filter.targetType) where.targetType = filter.targetType;
    if (filter.targetId !== undefined) where.targetId = filter.targetId;
    if (filter.status) where.status = filter.status;
    if (filter.reporterId !== undefined) where.reporterId = filter.reporterId;

    const orderBy = buildOrderBy<Prisma.ReportOrderByWithRelationInput>(
      filter,
      AdminReportService.SORTABLE_FIELDS,
      "createdAt"
    );

    const [reports, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy,
        include: { reporter: { select: { username: true } } }
      }),
      this.prisma.report.count({ where })
    ]);

    const labels = await this.targetLinks.resolve(
      reports.map((report) => ({
        id: report.targetId,
        type: report.targetType
      }))
    );

    return {
      data: reports.map((report) =>
        this.toResponse(
          report,
          labels.get(`${report.targetType}:${report.targetId}`)?.label ??
            `${report.targetType} #${report.targetId}`
        )
      ),
      meta: buildMeta(total, page)
    };
  }

  async findOne(id: number): Promise<AdminReportDetailDto> {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: { reporter: { select: { username: true } } }
    });
    if (!report) {
      throw new NotFoundException(`Report with ID ${id} not found`);
    }

    const [moderationActions, link] = await Promise.all([
      this.prisma.moderationAction.findMany({
        where: { reportId: id },
        orderBy: { createdAt: "desc" }
      }),
      this.targetLinks.resolveSingle(report.targetType, report.targetId)
    ]);

    const base = this.toResponse(
      report,
      link?.label ?? `${report.targetType} #${report.targetId}`
    );

    return {
      ...base,
      moderationActions: moderationActions.map((action) => ({
        id: action.id,
        action: action.action,
        actorId: action.actorId,
        targetType: action.targetType,
        targetId: action.targetId,
        reason: action.reason,
        createdAt: action.createdAt.toISOString()
      }))
    };
  }

  async updateNote(
    id: number,
    actorId: number,
    note: string | null
  ): Promise<AdminReportDetailDto> {
    await this.moderationService.updateReportNote(id, actorId, note);
    return this.findOne(id);
  }

  async transition(
    id: number,
    actorId: number,
    newStatus: ReportStatus,
    resolutionNote?: string
  ): Promise<AdminReportDetailDto> {
    await this.moderationService.setReportStatus(
      id,
      actorId,
      newStatus,
      resolutionNote ?? null
    );
    return this.findOne(id);
  }

  private toResponse(
    report: ReportWithRels,
    targetLabel: string
  ): AdminReportResponseDto {
    return {
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      targetLabel,
      reporterId: report.reporterId,
      reporterUsername: report.reporter?.username,
      reason: report.reason,
      details: report.details,
      status: report.status,
      resolutionNote: report.resolutionNote,
      resolvedAt: report.resolvedAt?.toISOString() ?? null,
      resolvedById: report.resolvedById,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString()
    };
  }
}
