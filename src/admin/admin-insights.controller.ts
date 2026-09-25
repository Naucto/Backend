import { Permission } from "@auth/permissions";
import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards
} from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiTags
} from "@nestjs/swagger";
import { Permissions } from "@auth/decorators/permissions.decorator";
import { PermissionsGuard } from "@auth/guards/permissions.guard";
import { StaffSessionGuard } from "@auth/guards/staff-session.guard";
import { AdminInsightsService } from "./admin-insights.service";

@ApiTags("admin-insights")
@ApiCookieAuth("AdminCookie")
@UseGuards(StaffSessionGuard, PermissionsGuard)
@Permissions(Permission.VIEW_ACTIVITY)
@Controller("admin/insights")
export class AdminInsightsController {
  constructor(private readonly insightsService: AdminInsightsService) {}

  @Get("dashboard")
  @Permissions(Permission.VIEW_INSIGHTS)
  @ApiOperation({ summary: "Full admin dashboard payload" })
  @ApiQuery({ name: "days", required: false, type: Number })
  async getDashboard(
    @Query("days", new DefaultValuePipe(30), ParseIntPipe) days: number
  ): Promise<Record<string, unknown>> {
    return this.insightsService.getDashboard(days);
  }

  @Get("live")
  @ApiOperation({ summary: "Live activity metrics and active sessions" })
  async getLive(): Promise<Record<string, unknown>> {
    return this.insightsService.getLiveActivity();
  }

  @Get("social")
  @ApiOperation({ summary: "Social engagement metrics" })
  async getSocial(): Promise<Record<string, unknown>> {
    return this.insightsService.getSocialOverview();
  }
}
