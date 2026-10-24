import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequiresRole } from '../../auth/access/access.decorators';
import { ADMIN } from '../../auth/access/roles';
import { AdminReportsService } from './admin-reports.service';
import { AdminReportDetailDto, AdminReportListDto, UpdateReportDto } from './dto/admin-report.dto';
import { AdminReportQueryDto } from './dto/admin-report-query.dto';
import { RatingSummaryDto, RatingSummaryQueryDto } from './dto/rating-summary.dto';

@ApiTags('admin')
@Controller('admin/reports')
@RequiresRole(ADMIN)
export class AdminReportsController {
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
        from: query.from,
        to: query.to,
      },
      { page: query.page, limit: query.limit },
    );
  }

  @Get('ratings/summary')
  @ApiOperation({ summary: 'Average, distribution and trend of the ratings in a range' })
  @ApiResponse({ status: HttpStatus.OK, type: RatingSummaryDto })
  ratingSummary(@Query() query: RatingSummaryQueryDto): Promise<RatingSummaryDto> {
    return this.reports.ratingSummary(query.from, query.to, query.grain);
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
}
