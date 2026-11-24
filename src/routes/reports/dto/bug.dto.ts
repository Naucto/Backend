import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BugCategory, ReportRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { IsId } from '../../../common/decorators/is-id';
import { trimmed } from './report-transforms';

export const BUG_TITLE_MIN_LENGTH = 3;
export const BUG_TITLE_MAX_LENGTH = 120;
export const BUG_DESCRIPTION_MIN_LENGTH = 10;
export const BUG_DESCRIPTION_MAX_LENGTH = 4_000;
export const CONSOLE_LINES_MAX = 50;
export const CONSOLE_LINE_MAX_LENGTH = 500;
export const PATH_MAX_LENGTH = 200;
export const APP_RELEASE_MAX_LENGTH = 64;
/** A path of the web app, without its query or fragment, as in `/hub` or `/play/<id>`. */
export const PATH_PATTERN = /^\/[A-Za-z0-9_\-/.:]*$/;

/** What the browser attaches to a bug report, every field of it listed to the person first. */
export class BugContextDto {
  @ApiPropertyOptional({ example: '1920x1080' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  viewport?: string;

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

  @ApiPropertyOptional({ type: [String], description: 'The last lines of the game console' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONSOLE_LINES_MAX)
  @IsString({ each: true })
  @MaxLength(CONSOLE_LINE_MAX_LENGTH, { each: true })
  console?: string[];
}

export class CreateBugReportDto {
  @ApiProperty({ enum: BugCategory, enumName: 'BugCategory' })
  @IsEnum(BugCategory)
  category!: BugCategory;

  @ApiProperty({ minLength: BUG_TITLE_MIN_LENGTH, maxLength: BUG_TITLE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(BUG_TITLE_MIN_LENGTH)
  @MaxLength(BUG_TITLE_MAX_LENGTH)
  title!: string;

  @ApiProperty({ minLength: BUG_DESCRIPTION_MIN_LENGTH, maxLength: BUG_DESCRIPTION_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @MinLength(BUG_DESCRIPTION_MIN_LENGTH)
  @MaxLength(BUG_DESCRIPTION_MAX_LENGTH)
  description!: string;

  @ApiProperty({
    example: '/play/3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
    maxLength: PATH_MAX_LENGTH,
  })
  @IsString()
  @MaxLength(PATH_MAX_LENGTH)
  @Matches(PATH_PATTERN)
  route!: string;

  @ApiPropertyOptional({ enum: ReportRole, enumName: 'ReportRole' })
  @IsOptional()
  @IsEnum(ReportRole)
  role?: ReportRole;

  @ApiPropertyOptional({ format: 'uuid', description: 'The release the page is about' })
  @IsOptional()
  @IsId()
  releaseId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'The project open in the editor' })
  @IsOptional()
  @IsId()
  projectId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The rating the report follows, for a low score',
  })
  @IsOptional()
  @IsId()
  ratingId?: string;

  @ApiPropertyOptional({
    description: 'The build of the web app',
    maxLength: APP_RELEASE_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(APP_RELEASE_MAX_LENGTH)
  appRelease?: string;

  @ApiPropertyOptional({ type: BugContextDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => BugContextDto)
  context?: BugContextDto;
}
