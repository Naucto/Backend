import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags
} from "@nestjs/swagger";
import { JwtAuthGuard } from "@auth/guards/jwt-auth.guard";
import { AccountWriteGuard } from "@auth/guards/account-write.guard";
import { RequestWithUser } from "@auth/auth.types";
import { ModerationService } from "./moderation.service";
import { CreateReportDto } from "./dto/create-report.dto";
import { ReportResponseDto } from "./dto/report-response.dto";

@ApiTags("reports")
@ApiBearerAuth("JWT-auth")
@Controller("reports")
@UseGuards(JwtAuthGuard, AccountWriteGuard)
export class ReportController {
  constructor(private readonly moderationService: ModerationService) {}

  @Post()
  @ApiOperation({ summary: "Report a user, project, or comment for moderation" })
  @ApiBody({ type: CreateReportDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: "Report submitted",
    type: ReportResponseDto
  })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Req() request: RequestWithUser,
    @Body() dto: CreateReportDto
  ): Promise<ReportResponseDto> {
    return this.moderationService.createReport(request.user.id, dto);
  }
}
