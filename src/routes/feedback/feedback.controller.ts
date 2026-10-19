import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { BugCategory } from '@prisma/client';

import { RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import {
  BUG_DESCRIPTION_MAX_LENGTH,
  BUG_TITLE_MAX_LENGTH,
  BugContextDto,
  CreateBugReportDto,
  CreatedFeedbackDto,
  CreateRatingDto,
  FeedbackPromptStateDto,
  UpdateFeedbackPromptDto,
} from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';
import { OPTIONAL_SCREENSHOT, ScreenshotUpload } from './screenshot-upload';

const HOUR_MS = 60 * 60 * 1000;

@ApiTags('feedback')
@ApiExtraModels(BugContextDto)
@Controller('feedback')
@RequiresAuth()
@UseGuards(ThrottlerGuard)
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get('prompt')
  @ApiOperation({ summary: 'Whether the rating prompt may ask the signed-in account now' })
  @ApiResponse({ status: HttpStatus.OK, type: FeedbackPromptStateDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Feedback is off' })
  prompt(@Req() req: RequestWithUser): Promise<FeedbackPromptStateDto> {
    this.feedback.assertEnabled();
    return this.feedback.promptState(req.user.id);
  }

  @Put('prompt')
  @ApiOperation({ summary: 'Snooze or decline the rating prompt, or let it ask again' })
  @ApiResponse({ status: HttpStatus.OK, type: FeedbackPromptStateDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Feedback is off' })
  updatePrompt(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateFeedbackPromptDto,
  ): Promise<FeedbackPromptStateDto> {
    this.feedback.assertEnabled();
    return this.feedback.updatePrompt(req.user.id, dto.action);
  }

  @Post('ratings')
  @Throttle({ identity: { limit: 5, ttl: HOUR_MS } })
  @ApiOperation({ summary: 'Rate the platform out of 10, with optional comments' })
  @ApiResponse({ status: HttpStatus.CREATED, type: CreatedFeedbackDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Feedback is off' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many ratings' })
  createRating(
    @Req() req: RequestWithUser,
    @Body() dto: CreateRatingDto,
  ): Promise<CreatedFeedbackDto> {
    this.feedback.assertEnabled();
    return this.feedback.createRating(req.user.id, dto);
  }

  @Post('bugs')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ identity: { limit: 10, ttl: 24 * HOUR_MS } })
  @ScreenshotUpload()
  @ApiBody({
    schema: {
      type: 'object',
      required: ['category', 'title', 'description', 'route'],
      properties: {
        category: { type: 'string', enum: Object.values(BugCategory) },
        title: { type: 'string', minLength: 3, maxLength: BUG_TITLE_MAX_LENGTH },
        description: { type: 'string', minLength: 10, maxLength: BUG_DESCRIPTION_MAX_LENGTH },
        route: { type: 'string', example: '/play/42' },
        releaseId: { type: 'integer' },
        projectId: { type: 'integer' },
        ratingId: { type: 'integer' },
        context: { type: 'string', description: 'A JSON-encoded BugContextDto' },
        screenshot: { type: 'string', format: 'binary', description: 'PNG, JPEG or WebP, 2 MB' },
      },
    },
  })
  @ApiOperation({ summary: 'Report a bug, with an optional screenshot of at most 2 MB' })
  @ApiResponse({ status: HttpStatus.CREATED, type: CreatedFeedbackDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Feedback is off' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many reports' })
  createBugReport(
    @Req() req: RequestWithUser,
    @Body() dto: CreateBugReportDto,
    @UploadedFile(OPTIONAL_SCREENSHOT) screenshot: Express.Multer.File | undefined,
  ): Promise<CreatedFeedbackDto> {
    this.feedback.assertEnabled();
    return this.feedback.createBugReport(req.user.id, dto, req.get('user-agent'), screenshot);
  }
}
