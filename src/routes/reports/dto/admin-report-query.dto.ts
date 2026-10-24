import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportKind, ReportRole, ReportStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { DAY_PATTERN } from '../../analytics/dto/admin-analytics-query.dto';
import { RATING_MAX, RATING_MIN } from './rating.dto';
import { queryBoolean } from './report-transforms';

export const REPORT_VIEWS = ['NEW', 'OPEN', 'CLOSED', 'ALL'] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

export class AdminReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportKind, enumName: 'ReportKind' })
  @IsOptional()
  @IsEnum(ReportKind)
  kind?: ReportKind;

  @ApiPropertyOptional({
    enum: REPORT_VIEWS,
    description: 'NEW alone, OPEN for anything not closed, CLOSED for resolved or ignored',
  })
  @IsOptional()
  @IsIn(REPORT_VIEWS)
  view?: ReportView;

  @ApiPropertyOptional({
    enum: ReportStatus,
    enumName: 'ReportStatus',
    description: 'Wins over view',
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportRole, enumName: 'ReportRole' })
  @IsOptional()
  @IsEnum(ReportRole)
  role?: ReportRole;

  @ApiPropertyOptional({ description: 'Only ratings up to this score', minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(RATING_MIN)
  @Max(RATING_MAX)
  maxScore?: number;

  @ApiPropertyOptional({ description: 'Only ratings that came with a comment' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  withComments?: boolean;

  @ApiPropertyOptional({ description: 'First day, UTC, as YYYY-MM-DD' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  from?: string;

  @ApiPropertyOptional({ description: 'Last day, UTC, as YYYY-MM-DD, included' })
  @IsOptional()
  @Matches(DAY_PATTERN)
  to?: string;
}
