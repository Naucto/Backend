import { Body, Controller, Get, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { RequiresAuth } from '../../auth/access/access.decorators';
import { RequestWithUser } from '../../auth/auth.types';
import { CreatedReportDto } from './dto/created-report.dto';
import { FeedbackPromptDto, UpdateFeedbackPromptDto } from './dto/prompt.dto';
import { CreateRatingDto } from './dto/rating.dto';
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
}
