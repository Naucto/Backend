import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BugCategory,
  CrashSource,
  RatingOrigin,
  RatingReason,
  ReportKind,
  ReportRole,
  ReportStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

import { AccountSummaryDto } from '../../admin/dto/admin-account.dto';
import { RATING_MAX, RATING_MIN } from './rating.dto';

export const ADMIN_NOTE_MAX_LENGTH = 2_000;

/** The account a report came from, with where to find it on the site. */
export class ReportAccountDto extends AccountSummaryDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The public profile on the web app, null once the account is deleted',
  })
  profileUrl!: string | null;

  @ApiProperty()
  deleted!: boolean;
}

export class ReportReleaseDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  name!: string;
}

/** One report as a list shows it. The fields of the other kinds are null. */
export class AdminReportDto {
  @ApiProperty()
  id!: number;

  @ApiProperty({ enum: ReportKind, enumName: 'ReportKind' })
  kind!: ReportKind;

  @ApiProperty({ enum: ReportStatus, enumName: 'ReportStatus' })
  status!: ReportStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiPropertyOptional({ type: ReportAccountDto, nullable: true })
  account!: ReportAccountDto | null;

  @ApiPropertyOptional({ enum: ReportRole, enumName: 'ReportRole', nullable: true })
  role!: ReportRole | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '/play/42' })
  route!: string | null;

  @ApiPropertyOptional({ type: ReportReleaseDto, nullable: true })
  release!: ReportReleaseDto | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The build of the web app' })
  appRelease!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'A bug report summary' })
  title!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'A bug report description' })
  message!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: RATING_MIN, maximum: RATING_MAX })
  score!: number | null;

  @ApiProperty({ enum: RatingReason, enumName: 'RatingReason', isArray: true })
  reasons!: RatingReason[];

  @ApiPropertyOptional({ type: String, nullable: true })
  liked!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  improve!: string | null;

  @ApiPropertyOptional({ enum: RatingOrigin, enumName: 'RatingOrigin', nullable: true })
  origin!: RatingOrigin | null;

  @ApiProperty({ type: [Number], description: 'Bug reports opened from this rating' })
  followUpIds!: number[];

  @ApiPropertyOptional({ enum: BugCategory, enumName: 'BugCategory', nullable: true })
  category!: BugCategory | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The rating a bug followed' })
  ratingId!: number | null;

  @ApiProperty()
  hasScreenshot!: boolean;

  @ApiPropertyOptional({ enum: CrashSource, enumName: 'CrashSource', nullable: true })
  source!: CrashSource | null;

  @ApiProperty({ description: 'How many times a crash happened, 1 for any other report' })
  count!: number;

  @ApiPropertyOptional({ type: Date, nullable: true, description: 'When a crash last happened' })
  lastSeen!: Date | null;

  @ApiPropertyOptional({
    type: Date,
    nullable: true,
    description: 'When a resolved crash was last reported again',
  })
  regressedAt!: Date | null;
}

export class AdminReportListDto {
  @ApiProperty({ type: [AdminReportDto] })
  items!: AdminReportDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}

export class LinkedRatingDto {
  @ApiProperty()
  id!: number;

  @ApiProperty()
  score!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  liked!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  improve!: string | null;
}

export class ScreenshotInfoDto {
  @ApiProperty({ example: 'image/webp' })
  mime!: string;

  @ApiProperty()
  bytes!: number;
}

export class ReportOccurrenceDto {
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

export class AdminReportDetailDto extends AdminReportDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  adminNote!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  projectId!: number | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'What the browser attached: viewport, language, browser family, errors, console',
  })
  context!: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: LinkedRatingDto, nullable: true })
  rating!: LinkedRatingDto | null;

  @ApiPropertyOptional({ type: ScreenshotInfoDto, nullable: true })
  screenshot!: ScreenshotInfoDto | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The latest stack of a crash, mapped back to the sources when possible',
  })
  stack!: string | null;

  @ApiProperty({ type: [ReportOccurrenceDto], description: 'The latest occurrences, newest first' })
  occurrences!: ReportOccurrenceDto[];
}

export class ReportCountDto {
  @ApiProperty()
  count!: number;
}

export class UpdateReportDto {
  @ApiPropertyOptional({ enum: ReportStatus, enumName: 'ReportStatus' })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: ADMIN_NOTE_MAX_LENGTH })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(ADMIN_NOTE_MAX_LENGTH)
  adminNote?: string | null;
}
