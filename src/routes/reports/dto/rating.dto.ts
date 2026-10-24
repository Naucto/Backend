import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RatingOrigin, RatingReason, ReportRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { trimmed } from './report-transforms';

export const RATING_MIN = 1;
export const RATING_MAX = 10;
export const COMMENT_MAX_LENGTH = 1_000;

export class CreateRatingDto {
  @ApiProperty({ minimum: RATING_MIN, maximum: RATING_MAX, example: 8 })
  @IsInt()
  @Min(RATING_MIN)
  @Max(RATING_MAX)
  score!: number;

  @ApiProperty({
    enum: ReportRole,
    enumName: 'ReportRole',
    description: 'What the person mostly does on Naucto',
  })
  @IsEnum(ReportRole)
  role!: ReportRole;

  @ApiProperty({ enum: RatingOrigin, enumName: 'RatingOrigin' })
  @IsEnum(RatingOrigin)
  origin!: RatingOrigin;

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

  @ApiPropertyOptional({ description: 'The release played just before the prompt' })
  @IsOptional()
  @IsInt()
  @Min(1)
  releaseId?: number;
}
