import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { AllowedWhileSuspended, RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { ParseIdPipe } from '../../common/pipes/parse-id.pipe';
import { CreateBugReportDto } from './dto/bug.dto';
import { CreatedReportDto } from './dto/created-report.dto';
import { FeedbackPromptDto, UpdateFeedbackPromptDto } from './dto/prompt.dto';
import { CreateRatingDto } from './dto/rating.dto';
import { SCREENSHOT_FILE, ScreenshotUpload } from './report-screenshot';
import { ReportsService } from './reports.service';

const HOUR_MS = 60 * 60 * 1000;

@ApiTags('reports')
@Controller('reports')
@RequiresAuth()
@UseGuards(ThrottlerGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('prompt')
  @ApiOperation({ summary: 'Whether the rating prompt may ask the signed-in account now' })
  @ApiResponse({ status: HttpStatus.OK, type: FeedbackPromptDto })
  prompt(@Req() req: RequestWithUser): Promise<FeedbackPromptDto> {
    return this.reports.promptState(req.user.id);
  }

  @Put('prompt')
  @AllowedWhileSuspended()
  @ApiOperation({ summary: 'Snooze or decline the rating prompt, or let it ask again' })
  @ApiResponse({ status: HttpStatus.OK, type: FeedbackPromptDto })
  updatePrompt(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateFeedbackPromptDto,
  ): Promise<FeedbackPromptDto> {
    return this.reports.updatePrompt(req.user.id, dto.action);
  }

  @Post('ratings')
  @Throttle({ identity: { limit: 5, ttl: HOUR_MS } })
  @ApiOperation({ summary: 'Rate the platform out of 10, with optional comments' })
  @ApiResponse({ status: HttpStatus.CREATED, type: CreatedReportDto })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many ratings' })
  createRating(
    @Req() req: RequestWithUser,
    @Body() dto: CreateRatingDto,
  ): Promise<CreatedReportDto> {
    return this.reports.createRating(req.user.id, {
      score: dto.score,
      role: dto.role,
      origin: dto.origin,
      reasons: dto.reasons ?? [],
      liked: dto.liked,
      improve: dto.improve,
      releaseId: dto.releaseId,
    });
  }

  @Post('bugs')
  @Throttle({ identity: { limit: 10, ttl: 24 * HOUR_MS } })
  @ApiOperation({ summary: 'Report a bug. Its screenshot, if any, follows on its own route' })
  @ApiResponse({ status: HttpStatus.CREATED, type: CreatedReportDto })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many reports' })
  createBugReport(
    @Req() req: RequestWithUser,
    @Body() dto: CreateBugReportDto,
  ): Promise<CreatedReportDto> {
    return this.reports.createBugReport(
      req.user.id,
      {
        category: dto.category,
        title: dto.title,
        description: dto.description,
        route: dto.route,
        role: dto.role,
        releaseId: dto.releaseId,
        projectId: dto.projectId,
        ratingId: dto.ratingId,
        appRelease: dto.appRelease,
        context: dto.context,
      },
      req.get('user-agent'),
    );
  }

  @Put('bugs/:id/screenshot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ identity: { limit: 10, ttl: 24 * HOUR_MS } })
  @ScreenshotUpload()
  @ApiOperation({ summary: 'Attach a screenshot to a bug report sent within the hour' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Attached' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not a bug report of this account' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Already has one, or too late' })
  attachScreenshot(
    @Req() req: RequestWithUser,
    @Param('id', ParseIdPipe) id: string,
    @UploadedFile(SCREENSHOT_FILE) screenshot: Express.Multer.File,
  ): Promise<void> {
    return this.reports.attachScreenshot(req.user.id, id, screenshot);
  }
}
