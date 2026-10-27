import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyticsGrain } from '@prisma/client';
import { IsEnum, Matches } from 'class-validator';

import { DAY_PATTERN } from '../../analytics/dto/admin-analytics-query.dto';

export class RatingSummaryQueryDto {
  @ApiProperty({ description: 'First day, UTC, as YYYY-MM-DD', example: '2026-09-01' })
  @Matches(DAY_PATTERN)
  from!: string;

  @ApiProperty({ description: 'Last day, UTC, as YYYY-MM-DD, included', example: '2026-09-30' })
  @Matches(DAY_PATTERN)
  to!: string;

  @ApiProperty({ enum: AnalyticsGrain, enumName: 'AnalyticsGrain' })
  @IsEnum(AnalyticsGrain)
  grain!: AnalyticsGrain;
}

export class RatingAverageDto {
  @ApiProperty()
  count!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Null with no rating' })
  average!: number | null;
}

export class RatingBucketDto extends RatingAverageDto {
  @ApiProperty({ description: 'First day of the period, as YYYY-MM-DD' })
  start!: string;
}

export class RatingSummaryDto extends RatingAverageDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Share of ratings of 4 or less, from 0 to 1',
  })
  lowShare!: number | null;

  @ApiProperty({ type: [Number], description: 'How many ratings gave each score, 1 to 10' })
  distribution!: number[];

  @ApiProperty({ type: RatingAverageDto, description: 'Ratings from people who mostly play' })
  player!: RatingAverageDto;

  @ApiProperty({ type: RatingAverageDto, description: 'Ratings from people who mostly create' })
  creator!: RatingAverageDto;

  @ApiProperty({ type: [RatingBucketDto] })
  series!: RatingBucketDto[];
}
