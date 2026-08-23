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
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { buildMeta, resolvePage } from "./admin-pagination.util";
import { TargetLinkService } from "./services/target-link.service";
import { AuditEntry, AuditService } from "src/moderation/audit";
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
    private readonly auditService: AuditService,
    private readonly targetLinks: TargetLinkService
  ) {}

  private toLogEntry(
    entry: AuditEntry,
    labels: Map<string, { label: string }>
  ): ModerationLogResponseDto {
    return {
      id: entry.id,
      actorId: entry.actorId,
      actorLabel: entry.actor?.username ? `@${entry.actor.username}` : null,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetLabel:
        labels.get(`${entry.targetType}:${entry.targetId}`)?.label ??
        `${entry.targetType} #${entry.targetId}`,
      action: entry.action,
      reason: entry.reason,
      reportId: entry.reportId,
      createdAt: entry.createdAt.toISOString()
    };
  }

  @Get()
  @ApiOperation({ summary: "List moderation actions" })
  async list(
    @Query() filter: ModerationLogFilterDto
  ): Promise<ModerationLogListResponseDto> {
    const page = resolvePage(filter);

    // Reads go through AuditService like every other moderation read, so the
    // feed and a single target's history cannot drift apart.
    const { entries, total } = await this.auditService.search(filter, {
      skip: page.skip,
      take: page.take
    });

    const labels = await this.targetLinks.resolve(
      entries.map((entry) => ({ id: entry.targetId, type: entry.targetType }))
    );

    return {
      data: entries.map((entry) => this.toLogEntry(entry, labels)),
      meta: buildMeta(total, page)
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single moderation action with before/after snapshots" })
  async get(
    @Param("id", ParseIntPipe) id: number
  ): Promise<ModerationLogDetailDto> {
    const action = await this.auditService.findEntry(id);
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
