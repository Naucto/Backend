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
import { Roles } from "@auth/decorators/roles.decorator";
import { RolesGuard } from "@auth/guards/roles.guard";
import { AdminCookieJwtGuard } from "./guards/admin-cookie-jwt.guard";
import { AdminInsightsService } from "./admin-insights.service";

@ApiTags("admin-insights")
@ApiCookieAuth("AdminCookie")
@UseGuards(AdminCookieJwtGuard, RolesGuard)
@Roles("Admin", "Moderator")
@Controller("admin/insights")
export class AdminInsightsController {
  constructor(private readonly insightsService: AdminInsightsService) {}

  @Get("dashboard")
  @Roles("Admin")
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
