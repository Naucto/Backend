import { Permission } from "@auth/permissions";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { ReportStatus } from "@prisma/client";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Permissions } from "@auth/decorators/permissions.decorator";
import { PermissionsGuard } from "@auth/guards/permissions.guard";
import { StaffSessionGuard } from "@auth/guards/staff-session.guard";
import { AdminActor } from "./decorators/admin-actor.decorator";
import { AdminReportService } from "./admin-report.service";
import { AdminReportFilterDto } from "./dto/reports/admin-report-filter.dto";
import { ReportActionDto } from "./dto/reports/report-action.dto";
import {
  AdminReportDetailDto,
  AdminReportListResponseDto
} from "./dto/reports/admin-report-response.dto";

@ApiTags("admin-reports")
@ApiCookieAuth("AdminCookie")
@UseGuards(StaffSessionGuard, PermissionsGuard)
@Permissions(Permission.MANAGE_REPORTS)
@Controller("admin/reports")
export class AdminReportController {
  constructor(private readonly adminReportService: AdminReportService) {}

  @Get()
  @ApiOperation({ summary: "List reports with pagination and filters" })
  async list(
    @Query() filter: AdminReportFilterDto
  ): Promise<AdminReportListResponseDto> {
    return this.adminReportService.list(filter);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a single report including audit history" })
  async get(
    @Param("id", ParseIntPipe) id: number
  ): Promise<AdminReportDetailDto> {
    return this.adminReportService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update the resolution note without changing status" })
  async update(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReportActionDto,
    @AdminActor() actorId: number
  ): Promise<AdminReportDetailDto> {
    return this.adminReportService.updateNote(
      id,
      actorId,
      dto.resolutionNote ?? null
    );
  }

  @Post(":id/review")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Transition report to IN_REVIEW" })
  async review(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReportActionDto,
    @AdminActor() actorId: number
  ): Promise<AdminReportDetailDto> {
    return this.adminReportService.transition(
      id,
      actorId,
      ReportStatus.IN_REVIEW,
      dto.resolutionNote
    );
  }

  @Post(":id/resolve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Transition report to RESOLVED" })
  async resolve(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReportActionDto,
    @AdminActor() actorId: number
  ): Promise<AdminReportDetailDto> {
    return this.adminReportService.transition(
      id,
      actorId,
      ReportStatus.RESOLVED,
      dto.resolutionNote
    );
  }

  @Post(":id/dismiss")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Transition report to DISMISSED" })
  async dismiss(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReportActionDto,
    @AdminActor() actorId: number
  ): Promise<AdminReportDetailDto> {
    return this.adminReportService.transition(
      id,
      actorId,
      ReportStatus.DISMISSED,
      dto.resolutionNote
    );
  }
}
