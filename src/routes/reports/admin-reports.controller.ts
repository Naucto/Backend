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
import { AdminReportsService } from './admin-reports.service';
import {
  AdminReportDetailDto,
  AdminReportListDto,
  ReportCountDto,
  UpdateReportDto,
} from './dto/admin-report.dto';
import { AdminReportQueryDto, ReportCountQueryDto } from './dto/admin-report-query.dto';
import { RatingSummaryDto, RatingSummaryQueryDto } from './dto/rating-summary.dto';

@ApiTags('admin')
@Controller('admin/reports')
@RequiresRole(ADMIN)
export class AdminReportsController {
  private readonly logger = new Logger(AdminReportsController.name);

  constructor(private readonly reports: AdminReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Reports, newest first, filtered by kind, status and their fields' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminReportListDto })
  list(@Query() query: AdminReportQueryDto): Promise<AdminReportListDto> {
    return this.reports.list(
      {
        kind: query.kind,
        view: query.view,
        status: query.status,
        role: query.role,
        maxScore: query.maxScore,
        withComments: query.withComments,
        category: query.category,
        source: query.source,
        from: query.from,
        to: query.to,
      },
      query.sort ?? 'created',
      { page: query.page, limit: query.limit },
    );
  }

  @Get('ratings/summary')
  @ApiOperation({ summary: 'Average, distribution and trend of the ratings in a range' })
  @ApiResponse({ status: HttpStatus.OK, type: RatingSummaryDto })
  ratingSummary(@Query() query: RatingSummaryQueryDto): Promise<RatingSummaryDto> {
    return this.reports.ratingSummary(query.from, query.to, query.grain);
  }

  @Get('count')
  @ApiOperation({ summary: 'How many reports of a kind, in a status if given' })
  @ApiResponse({ status: HttpStatus.OK, type: ReportCountDto })
  async count(@Query() query: ReportCountQueryDto): Promise<ReportCountDto> {
    return { count: await this.reports.count(query.kind, query.status) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One report in full' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminReportDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such report' })
  detail(@Param('id', ParseIntPipe) id: number): Promise<AdminReportDetailDto> {
    return this.reports.detail(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Set the status of a report or the note of the team' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminReportDetailDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such report' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReportDto,
  ): Promise<AdminReportDetailDto> {
    return this.reports.update(id, { status: dto.status, adminNote: dto.adminNote });
  }

  @Get(':id/screenshot')
  @ApiOperation({ summary: 'The screenshot of a bug report, served privately' })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiResponse({ status: HttpStatus.OK, description: 'The image' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No screenshot' })
  async screenshot(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const file = await this.reports.screenshot(id);
    res.set({
      'Content-Type': file.contentType ?? 'application/octet-stream',
      ...(file.contentLength !== undefined ? { 'Content-Length': String(file.contentLength) } : {}),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="report-${id}-screenshot"`,
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
