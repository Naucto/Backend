import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnalyticsGrain,
  BugCategory,
  BugStatus,
  CrashSource,
  CrashStatus,
  FeedbackContext,
  FeedbackSource,
  RatingReason,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AccountSummaryDto } from '../../admin/dto/admin-account.dto';
import { DAY_PATTERN } from '../../analytics/dto/admin-analytics-query.dto';
import { RATING_MAX, RATING_MIN } from './feedback.dto';

export const ADMIN_NOTE_MAX_LENGTH = 2_000;

const queryBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** The account a piece of feedback came from, with where to find it on the site. */
export class FeedbackAccountDto extends AccountSummaryDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The public profile on the web app, null once the account is deleted',
  })
  profileUrl!: string | null;

  @ApiProperty()
  deleted!: boolean;
}

export class FeedbackReleaseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

export class AdminRatingDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ minimum: RATING_MIN, maximum: RATING_MAX })
  score!: number;

  @ApiProperty({ enum: RatingReason, enumName: 'RatingReason', isArray: true })
  reasons!: RatingReason[];

  @ApiPropertyOptional({ type: String, nullable: true })
  liked!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  improve!: string | null;

  @ApiProperty({ enum: FeedbackContext, enumName: 'FeedbackContext' })
  context!: FeedbackContext;

  @ApiProperty({ enum: FeedbackSource, enumName: 'FeedbackSource' })
  source!: FeedbackSource;

  @ApiPropertyOptional({ type: String, nullable: true })
  appRelease!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: FeedbackAccountDto })
  account!: FeedbackAccountDto;

  @ApiPropertyOptional({ type: FeedbackReleaseDto, nullable: true })
  release!: FeedbackReleaseDto | null;

  @ApiProperty({ type: [Number], description: 'Bug reports opened from this rating' })
  bugReportIds!: number[];
}

export class AdminRatingListDto {
  @ApiProperty({ type: [AdminRatingDto] })
  items!: AdminRatingDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class AdminRatingQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: FeedbackContext, enumName: 'FeedbackContext' })
  @IsOptional()
  @IsEnum(FeedbackContext)
  context?: FeedbackContext;

  @ApiPropertyOptional({ description: 'Only scores up to this one', minimum: 1, maximum: 10 })
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

  @ApiProperty({ type: RatingAverageDto })
  player!: RatingAverageDto;

  @ApiProperty({ type: RatingAverageDto })
  creator!: RatingAverageDto;

  @ApiProperty({ type: [RatingBucketDto] })
  series!: RatingBucketDto[];
}

export const BUG_VIEWS = ['NEW', 'OPEN', 'CLOSED', 'ALL'] as const;
export type BugView = (typeof BUG_VIEWS)[number];

export class AdminBugQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: BUG_VIEWS,
    description:
      'NEW alone, OPEN for anything not closed, CLOSED for resolved, declined or duplicate',
  })
  @IsOptional()
  @IsIn(BUG_VIEWS)
  view?: BugView;

  @ApiPropertyOptional({ enum: BugCategory, enumName: 'BugCategory' })
  @IsOptional()
  @IsEnum(BugCategory)
  category?: BugCategory;
}

export class AdminBugSummaryDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  title!: string;

  @ApiProperty({ enum: BugCategory, enumName: 'BugCategory' })
  category!: BugCategory;

  @ApiProperty({ enum: BugStatus, enumName: 'BugStatus' })
  status!: BugStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: FeedbackAccountDto })
  account!: FeedbackAccountDto;

  @ApiPropertyOptional({ type: FeedbackReleaseDto, nullable: true })
  release!: FeedbackReleaseDto | null;

  @ApiProperty()
  hasScreenshot!: boolean;
}

export class AdminBugListDto {
  @ApiProperty({ type: [AdminBugSummaryDto] })
  items!: AdminBugSummaryDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class BugRatingDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  score!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  liked!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  improve!: string | null;
}

export class BugScreenshotDto {
  @ApiProperty({ example: 'image/webp' })
  mime!: string;

  @ApiProperty()
  bytes!: number;
}

export class AdminBugDetailDto extends AdminBugSummaryDto {
  @ApiProperty()
  description!: string;

  @ApiProperty({ example: '/play/42' })
  route!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  projectId!: number | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'What the browser attached: viewport, release, browser family, errors, console',
  })
  context!: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, nullable: true })
  adminNote!: string | null;

  @ApiPropertyOptional({ type: BugRatingDto, nullable: true })
  rating!: BugRatingDto | null;

  @ApiPropertyOptional({ type: BugScreenshotDto, nullable: true })
  screenshot!: BugScreenshotDto | null;
}

export class UpdateBugReportDto {
  @ApiProperty({ enum: BugStatus, enumName: 'BugStatus' })
  @IsEnum(BugStatus)
  status!: BugStatus;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: ADMIN_NOTE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(ADMIN_NOTE_MAX_LENGTH)
  adminNote?: string | null;
}

export class BugCountDto {
  @ApiProperty()
  count!: number;
}

export const CRASH_SORTS = ['lastSeen', 'count'] as const;
export type CrashSort = (typeof CRASH_SORTS)[number];

export class AdminCrashQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: CrashSource, enumName: 'CrashSource' })
  @IsOptional()
  @IsEnum(CrashSource)
  source?: CrashSource;

  @ApiPropertyOptional({ enum: CrashStatus, enumName: 'CrashStatus' })
  @IsOptional()
  @IsEnum(CrashStatus)
  status?: CrashStatus;

  @ApiPropertyOptional({ enum: CRASH_SORTS, default: 'lastSeen' })
  @IsOptional()
  @IsIn(CRASH_SORTS)
  sort?: CrashSort;
}

export class AdminCrashGroupDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  fingerprint!: string;

  @ApiProperty({ enum: CrashSource, enumName: 'CrashSource' })
  source!: CrashSource;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  count!: number;

  @ApiProperty()
  firstSeen!: Date;

  @ApiProperty()
  lastSeen!: Date;

  @ApiPropertyOptional({ type: String, nullable: true })
  lastRelease!: string | null;

  @ApiProperty({ enum: CrashStatus, enumName: 'CrashStatus' })
  status!: CrashStatus;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: 'When a resolved group was last reported again',
  })
  regressedAt!: Date | null;
}

export class AdminCrashListDto {
  @ApiProperty({ type: [AdminCrashGroupDto] })
  items!: AdminCrashGroupDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class CrashEventDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  route!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  appRelease!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  device!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  browser!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  os!: string | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  extra!: Record<string, unknown> | null;
}

export class AdminCrashDetailDto extends AdminCrashGroupDto {
  @ApiProperty()
  lastStack!: string;

  @ApiProperty({ type: [CrashEventDto], description: 'The latest occurrences, newest first' })
  events!: CrashEventDto[];
}

export class UpdateCrashGroupDto {
  @ApiProperty({ enum: CrashStatus, enumName: 'CrashStatus' })
  @IsEnum(CrashStatus)
  status!: CrashStatus;
}
