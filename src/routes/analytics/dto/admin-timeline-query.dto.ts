import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  TIMELINE_BUCKET_NAMES,
  TIMELINE_METRIC_NAMES,
  TimelineBucket,
  TimelineMetric,
} from '../analytics-timeline';

export const SOURCE_PATTERN = /^(?:referrer|utmSource|utmCampaign):.{1,200}$/;

export class AnalyticsInstantRangeQueryDto {
  @ApiProperty({ description: 'First instant, ISO 8601', example: '2026-10-20T18:00:00Z' })
  @IsISO8601({ strict: true })
  from!: string;

  @ApiProperty({ description: 'Last instant, ISO 8601, excluded', example: '2026-10-21T18:00:00Z' })
  @IsISO8601({ strict: true })
  to!: string;
}

export class AnalyticsTimelineQueryDto extends AnalyticsInstantRangeQueryDto {
  @ApiPropertyOptional({
    enum: TIMELINE_BUCKET_NAMES,
    description: 'Bucket size, the finest one under 400 buckets when absent',
  })
  @IsOptional()
  @IsIn(TIMELINE_BUCKET_NAMES)
  bucket?: TimelineBucket;

  @ApiPropertyOptional({
    description: 'Comma-separated timeline metrics, every one when absent',
    example: 'visitors_new,plays_consented,plays_anonymous',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter((name) => name !== '') : value,
  )
  @IsArray()
  @ArrayMaxSize(TIMELINE_METRIC_NAMES.length)
  @IsIn(TIMELINE_METRIC_NAMES, { each: true })
  metrics?: TimelineMetric[];

  @ApiPropertyOptional({ description: 'Only what concerns this published project' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  releaseId?: number;

  @ApiPropertyOptional({
    description:
      'Only consenting sessions from this source, as `referrer:youtube.com`, `utmSource:newsletter`, `utmCampaign:launch`, or `referrer:(none)` for direct visits',
    maxLength: 220,
  })
  @IsOptional()
  @MaxLength(220)
  @Matches(SOURCE_PATTERN)
  source?: string;
}

export class AnalyticsActivityQueryDto extends AnalyticsInstantRangeQueryDto {
  @ApiPropertyOptional({ default: 200, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class AnalyticsArrivalsQueryDto extends AnalyticsActivityQueryDto {
  @ApiPropertyOptional({ description: 'Only browsers whose first session came from this source' })
  @IsOptional()
  @MaxLength(220)
  @Matches(SOURCE_PATTERN)
  source?: string;
}

export class AnalyticsReleasesQueryDto {
  @ApiPropertyOptional({
    description: 'Part of the name of a published game, or its id as `12` or `#12`',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @ApiPropertyOptional({
    description: 'Comma-separated project ids to name, published or not. The query is then ignored',
    example: '12,40',
    type: String,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .filter((id) => id !== '')
          .map(Number)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids?: number[];

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
