import { Controller, Delete, Get, HttpCode, HttpStatus, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import {
  UserAnalyticsEraseResponseDto,
  UserAnalyticsExportDto,
  UserAnalyticsSummaryDto,
} from './dto/user-analytics.dto';
import { UserAnalyticsService } from './user-analytics.service';

@ApiTags('analytics')
@Controller('users')
@RequiresAuth()
export class UserAnalyticsController {
  constructor(private readonly analytics: UserAnalyticsService) {}

  @Get('me/analytics')
  @ApiOperation({ summary: 'What analytics counted of the signed-in account' })
  @ApiResponse({ status: 200, type: UserAnalyticsSummaryDto })
  summary(@Req() req: RequestWithUser): Promise<UserAnalyticsSummaryDto> {
    return this.analytics.summary(req.user.id);
  }

  @Get('me/analytics/export')
  @ApiOperation({ summary: 'Everything analytics holds about the signed-in account, as a file' })
  @ApiProduces('application/json')
  @ApiResponse({ status: 200, type: UserAnalyticsExportDto })
  async export(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserAnalyticsExportDto> {
    res.setHeader('Content-Disposition', 'attachment; filename="naucto-analytics.json"');
    return this.analytics.export(req.user.id);
  }

  @Delete('me/analytics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Erase what analytics holds about the signed-in account; collection starts afresh',
  })
  @ApiResponse({ status: 200, type: UserAnalyticsEraseResponseDto })
  erase(@Req() req: RequestWithUser): Promise<UserAnalyticsEraseResponseDto> {
    return this.analytics.erase(req.user.id);
  }
}
