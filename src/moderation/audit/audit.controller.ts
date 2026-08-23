import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { ModerationTargetType } from "@prisma/client";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { RolesGuard } from "@auth/guards/roles.guard";
import { Roles } from "@auth/decorators/roles.decorator";
import { AdminPaginationDto } from "src/admin/dto/admin-pagination.dto";
import {
  buildMeta,
  resolvePage
} from "src/admin/admin-pagination.util";
import { AuditService } from "./audit.service";
import { AuditEntryDto, AuditLogResponseDto } from "./audit-entry.dto";

/**
 * Moderation history for any moderatable thing, addressed the same way
 * whatever it is: `/moderation-log/PROJECT/12`, `/moderation-log/COMMENT/34`.
 *
 * One route instead of a per-entity endpoint, and one place for the admin panel
 * to read "what happened to this?" from.
 */
@ApiTags("moderation-log")
@ApiBearerAuth("JWT-auth")
@Controller("moderation-log")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("Admin", "Moderator")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get(":targetType/:targetId")
  @ApiOperation({ summary: "Moderation history for one target" })
  @ApiParam({ name: "targetType", enum: ModerationTargetType })
  @ApiParam({ name: "targetId", type: "number" })
  @ApiResponse({ status: 200, type: AuditLogResponseDto })
  async historyOf(
    @Param("targetType") targetType: ModerationTargetType,
    @Param("targetId", ParseIntPipe) targetId: number,
    @Query() pagination: AdminPaginationDto
  ): Promise<AuditLogResponseDto> {
    const ref = { type: targetType, id: targetId };
    const page = resolvePage(pagination);

    const [entries, total] = await Promise.all([
      this.auditService.historyOf(ref, { skip: page.skip, take: page.take }),
      this.auditService.countFor(ref)
    ]);

    return {
      data: entries.map((entry) => AuditEntryDto.from(entry)),
      meta: buildMeta(total, page)
    };
  }
}
