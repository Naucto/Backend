import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { pipeline } from 'stream/promises';

import { RequiresRole } from '../../auth/access/access.decorators';
import { ADMIN } from '../../auth/access/roles';
import { AdminFeedbackService } from './admin-feedback.service';
import {
  AdminBugDetailDto,
  AdminBugListDto,
  AdminBugQueryDto,
  AdminRatingListDto,
  AdminRatingQueryDto,
  BugCountDto,
  RatingSummaryDto,
  RatingSummaryQueryDto,
  UpdateBugReportDto,
} from './dto/admin-feedback.dto';

@ApiTags('admin')
@Controller('admin/feedback')
@RequiresRole(ADMIN)
export class AdminFeedbackController {
  private readonly logger = new Logger(AdminFeedbackController.name);

  constructor(private readonly feedback: AdminFeedbackService) {}

  @Get('ratings')
  @ApiOperation({ summary: 'Platform ratings, newest first, with who gave them' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminRatingListDto })
  ratings(@Query() query: AdminRatingQueryDto): Promise<AdminRatingListDto> {
    return this.feedback.ratings(query);
  }

  @Get('ratings/summary')
  @ApiOperation({ summary: 'Average, distribution and trend of the ratings given in a range' })
  @ApiResponse({ status: HttpStatus.OK, type: RatingSummaryDto })
  ratingSummary(@Query() query: RatingSummaryQueryDto): Promise<RatingSummaryDto> {
    return this.feedback.ratingSummary(query);
  }

  @Get('bugs')
  @ApiOperation({ summary: 'Bug reports, newest first' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminBugListDto })
  bugs(@Query() query: AdminBugQueryDto): Promise<AdminBugListDto> {
    return this.feedback.bugs(query);
  }

  @Get('bugs/count')
  @ApiOperation({ summary: 'How many bug reports nobody has looked at yet' })
  @ApiResponse({ status: HttpStatus.OK, type: BugCountDto })
  async bugCount(): Promise<BugCountDto> {
    return { count: await this.feedback.newBugCount() };
  }

  @Get('bugs/:id')
  @ApiOperation({ summary: 'One bug report with everything it carried' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminBugDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such report' })
  bug(@Param('id', ParseIntPipe) id: number): Promise<AdminBugDetailDto> {
    return this.feedback.bug(id);
  }

  @Put('bugs/:id')
  @ApiOperation({ summary: "Set a bug report's status and the team's note on it" })
  @ApiResponse({ status: HttpStatus.OK, type: AdminBugDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such report' })
  updateBug(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBugReportDto,
  ): Promise<AdminBugDetailDto> {
    return this.feedback.updateBug(id, dto);
  }

  @Get('bugs/:id/screenshot')
  @ApiOperation({ summary: "A bug report's screenshot, served privately" })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiResponse({ status: HttpStatus.OK, description: 'The image' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No screenshot' })
  async screenshot(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const file = await this.feedback.screenshot(id);
    res.set({
      'Content-Type': file.contentType ?? 'application/octet-stream',
      ...(file.contentLength !== undefined ? { 'Content-Length': String(file.contentLength) } : {}),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="bug-${id}-screenshot"`,
    });
    try {
      await pipeline(file.body, res);
    } catch (error) {
      this.logger.warn(
        `Screenshot download interrupted: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
