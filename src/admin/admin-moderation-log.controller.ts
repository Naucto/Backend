import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  UseGuards
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { PrismaService } from "@ourPrisma/prisma.service";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { TargetLinkService } from "./services/target-link.service";
import { ModerationLogFilterDto } from "./dto/moderation-log/moderation-log-filter.dto";
import {
  ModerationLogDetailDto,
  ModerationLogListResponseDto,
  ModerationLogResponseDto
} from "./dto/moderation-log/moderation-log-response.dto";

@ApiTags("admin-moderation-log")
@ApiCookieAuth("AdminCookie")
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin", "Moderator")
@Controller("admin/moderation-log")
export class AdminModerationLogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targetLinks: TargetLinkService
  ) {}

  @Get()
  @ApiOperation({ summary: "List moderation actions" })
  async list(
    @Query() filter: ModerationLogFilterDto
  ): Promise<ModerationLogListResponseDto> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.ModerationActionWhereInput = {};
    if (filter.actorId !== undefined) where.actorId = filter.actorId;
    if (filter.targetType) where.targetType = filter.targetType;
    if (filter.targetId !== undefined) where.targetId = filter.targetId;
    if (filter.action) where.action = filter.action;
    if (filter.createdAfter || filter.createdBefore) {
      const createdAtFilter: Prisma.DateTimeFilter = {};
      if (filter.createdAfter) {
        createdAtFilter.gte = new Date(filter.createdAfter);
      }
      if (filter.createdBefore) {
        createdAtFilter.lte = new Date(filter.createdBefore);
      }
      where.createdAt = createdAtFilter;
    }

    const orderBy: Prisma.ModerationActionOrderByWithRelationInput = {
      createdAt: filter.order ?? "desc"
    };

    const [actions, total] = await Promise.all([
      this.prisma.moderationAction.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          actor: { select: { id: true, username: true } }
        }
      }),
      this.prisma.moderationAction.count({ where })
    ]);

    const labels = await this.targetLinks.resolve(
      actions.map((action) => ({
        id: action.targetId,
        type: action.targetType
      }))
    );

    return {
      data: actions.map((action) => ({
        id: action.id,
        actorId: action.actorId,
        actorLabel: action.actor?.username
          ? `@${action.actor.username}`
          : null,
        targetType: action.targetType,
        targetId: action.targetId,
        targetLabel:
          labels.get(`${action.targetType}:${action.targetId}`)?.label ??
          `${action.targetType} #${action.targetId}`,
        action: action.action,
        reason: action.reason,
        reportId: action.reportId,
        createdAt: action.createdAt.toISOString()
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single moderation action with before/after snapshots" })
  async get(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ModerationLogDetailDto> {
    const action = await this.prisma.moderationAction.findUnique({
      where: { id },
      include: { actor: { select: { id: true, username: true } } }
    });
    if (!action) {
      throw new NotFoundException(`Moderation action with ID ${id} not found`);
    }

    const link = await this.targetLinks.resolveSingle(
      action.targetType,
      action.targetId
    );

    const base: ModerationLogResponseDto = {
      id: action.id,
      actorId: action.actorId,
      actorLabel: action.actor?.username ? `@${action.actor.username}` : null,
      targetType: action.targetType,
      targetId: action.targetId,
      targetLabel:
        link?.label ?? `${action.targetType} #${action.targetId}`,
      action: action.action,
      reason: action.reason,
      reportId: action.reportId,
      createdAt: action.createdAt.toISOString()
    };

    return {
      ...base,
      before: action.before,
      after: action.after
    };
  }
}
