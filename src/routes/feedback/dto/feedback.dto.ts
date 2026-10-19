import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BugCategory, FeedbackContext, FeedbackSource, RatingReason } from '@prisma/client';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const COMMENT_MAX_LENGTH = 1_000;
export const BUG_TITLE_MAX_LENGTH = 120;
export const BUG_DESCRIPTION_MAX_LENGTH = 4_000;
export const CONSOLE_LINES_MAX = 50;
export const CONSOLE_LINE_MAX_LENGTH = 500;
export const PATH_MAX_LENGTH = 200;
export const APP_RELEASE_MAX_LENGTH = 64;
/** A path of the web app, without its query or fragment, as in `/play/42`. */
export const PATH_PATTERN = /^\/[A-Za-z0-9_\-/.:]*$/;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** A multipart field arrives as text; an empty one means the field was left out. */
const optionalNumber = ({ value }: { value: unknown }): unknown =>
  value === '' || value === undefined || value === null ? undefined : Number(value);

export const PROMPT_ACTIONS = ['snooze', 'decline', 'reset'] as const;
export type PromptAction = (typeof PROMPT_ACTIONS)[number];

export class FeedbackPromptStateDto {
  @ApiProperty({ description: 'Whether the rating prompt may be shown to this account now' })
  eligible!: boolean;

  @ApiProperty({ description: 'Whether this account asked never to be prompted again' })
  declined!: boolean;
}

export class UpdateFeedbackPromptDto {
  @ApiProperty({
    enum: PROMPT_ACTIONS,
    description:
      '`snooze` asks again in 14 days, `decline` never asks again, `reset` lets the prompt ask again',
  })
  @IsIn(PROMPT_ACTIONS)
  action!: PromptAction;
}

export class CreateRatingDto {
  @ApiProperty({ minimum: RATING_MIN, maximum: RATING_MAX, example: 8 })
  @IsInt()
  @Min(RATING_MIN)
  @Max(RATING_MAX)
  score!: number;

  @ApiPropertyOptional({ enum: RatingReason, enumName: 'RatingReason', isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(Object.keys(RatingReason).length)
  @IsEnum(RatingReason, { each: true })
  reasons?: RatingReason[];

  @ApiPropertyOptional({ description: 'What the person liked', maxLength: COMMENT_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(COMMENT_MAX_LENGTH)
  liked?: string;

  @ApiPropertyOptional({
    description: 'What the person would improve',
    maxLength: COMMENT_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(COMMENT_MAX_LENGTH)
  improve?: string;

  @ApiProperty({ enum: FeedbackContext, enumName: 'FeedbackContext' })
  @IsEnum(FeedbackContext)
  context!: FeedbackContext;

  @ApiProperty({ enum: FeedbackSource, enumName: 'FeedbackSource' })
  @IsEnum(FeedbackSource)
  source!: FeedbackSource;

  @ApiPropertyOptional({ description: 'The release played just before a prompt' })
  @IsOptional()
  @IsInt()
  @Min(1)
  releaseId?: number;

  @ApiPropertyOptional({ maxLength: APP_RELEASE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(APP_RELEASE_MAX_LENGTH)
  appRelease?: string;
}

export class CreatedFeedbackDto {
  @ApiProperty()
  id!: number;
}

/** What the browser attaches to a bug report; every field is listed to the person before sending. */
export class BugContextDto {
  @ApiPropertyOptional({ example: '1920x1080' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  viewport?: string;

  @ApiPropertyOptional({ maxLength: APP_RELEASE_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(APP_RELEASE_MAX_LENGTH)
  appRelease?: string;

  @ApiPropertyOptional({ example: 'en-GB' })
  @IsOptional()
  @IsString()
  @MaxLength(35)
  language?: string;

  @ApiPropertyOptional({ description: 'The engine error the game stopped on, with its traceback' })
  @IsOptional()
  @IsString()
  @MaxLength(BUG_DESCRIPTION_MAX_LENGTH)
  engineError?: string;

  @ApiPropertyOptional({ description: 'The app error the report was opened from' })
  @IsOptional()
  @IsString()
  @MaxLength(BUG_DESCRIPTION_MAX_LENGTH)
  appError?: string;

  @ApiPropertyOptional({ type: [String], description: 'The last lines of the game console' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONSOLE_LINES_MAX)
  @IsString({ each: true })
  @MaxLength(CONSOLE_LINE_MAX_LENGTH, { each: true })
  console?: string[];
}

const parseContext = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return plainToInstance(BugContextDto, JSON.parse(value) as unknown);
  } catch {
    return value;
  }
};

/** A bug report, sent as multipart form fields next to an optional `screenshot` file. */
export class CreateBugReportDto {
  @ApiProperty({ enum: BugCategory, enumName: 'BugCategory' })
  @IsEnum(BugCategory)
  category!: BugCategory;

  @ApiProperty({ minLength: 3, maxLength: BUG_TITLE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(BUG_TITLE_MAX_LENGTH)
  title!: string;

  @ApiProperty({ minLength: 10, maxLength: BUG_DESCRIPTION_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(10)
  @MaxLength(BUG_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiProperty({ description: 'The page the report was sent from', example: '/play/42' })
  @IsString()
  @MaxLength(PATH_MAX_LENGTH)
  @Matches(PATH_PATTERN)
  route!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(optionalNumber)
  @IsInt()
  @Min(1)
  releaseId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(optionalNumber)
  @IsInt()
  @Min(1)
  projectId?: number;

  @ApiPropertyOptional({ description: 'The rating this report follows, when opened from one' })
  @IsOptional()
  @Transform(optionalNumber)
  @IsInt()
  @Min(1)
  ratingId?: number;

  @ApiPropertyOptional({
    type: String,
    description: 'A JSON-encoded BugContextDto: multipart fields are text',
  })
  @IsOptional()
  @Transform(parseContext)
  @ValidateNested()
  @Type(() => BugContextDto)
  context?: BugContextDto;
}
