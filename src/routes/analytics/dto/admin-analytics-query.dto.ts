import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsGrain, AnalyticsRetentionKind } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { METRIC_NAMES, MetricName } from '../analytics-metrics';

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsRangeQueryDto {
  @ApiProperty({ description: 'First day, UTC, as YYYY-MM-DD', example: '2026-09-01' })
  @Matches(DAY_PATTERN)
  from!: string;

  @ApiProperty({ description: 'Last day, UTC, as YYYY-MM-DD, included', example: '2026-09-30' })
  @Matches(DAY_PATTERN)
  to!: string;
}

export class AnalyticsSeriesQueryDto extends AnalyticsRangeQueryDto {
  @ApiProperty({ enum: METRIC_NAMES, enumName: 'AnalyticsMetric' })
  @IsIn(METRIC_NAMES)
  metric!: MetricName;

  @ApiProperty({ enum: AnalyticsGrain, enumName: 'AnalyticsGrain' })
  @IsEnum(AnalyticsGrain)
  grain!: AnalyticsGrain;

  @ApiPropertyOptional({
    description: 'One value of a dimension of the metric, as `release:42`; the total when absent',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  dimension?: string;
}

export class AnalyticsPeriodQueryDto {
  @ApiProperty({ enum: AnalyticsGrain, enumName: 'AnalyticsGrain' })
  @IsEnum(AnalyticsGrain)
  grain!: AnalyticsGrain;

  @ApiProperty({
    description: 'Any day of the period, UTC, as YYYY-MM-DD; the period holding it is used',
  })
  @Matches(DAY_PATTERN)
  day!: string;
}

export class AnalyticsBreakdownQueryDto extends AnalyticsPeriodQueryDto {
  @ApiProperty({ enum: METRIC_NAMES, enumName: 'AnalyticsMetric' })
  @IsIn(METRIC_NAMES)
  metric!: MetricName;

  @ApiProperty({ description: 'A dimension the metric is split by, as `country`' })
  @IsString()
  @MaxLength(40)
  dimension!: string;
}

export class AnalyticsRetentionQueryDto extends AnalyticsRangeQueryDto {
  @ApiProperty({ enum: AnalyticsRetentionKind, enumName: 'AnalyticsRetentionKind' })
  @IsEnum(AnalyticsRetentionKind)
  kind!: AnalyticsRetentionKind;
}

export const GAME_SORTS = ['plays', 'playtime_ms', 'players', 'mp_sessions'] as const;
export type GameSort = (typeof GAME_SORTS)[number];

export class AnalyticsGamesQueryDto extends AnalyticsPeriodQueryDto {
  @ApiPropertyOptional({ enum: GAME_SORTS, default: 'plays' })
  @IsOptional()
  @IsIn(GAME_SORTS)
  sort?: GameSort;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AnalyticsPresenceQueryDto {
  @ApiProperty({ description: 'First instant, ISO 8601' })
  @IsString()
  @MaxLength(40)
  from!: string;

  @ApiProperty({ description: 'Last instant, ISO 8601; at most 7 days after the first' })
  @IsString()
  @MaxLength(40)
  to!: string;
}
