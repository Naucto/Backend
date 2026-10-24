import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RatingOrigin, RatingReason, ReportKind, ReportRole, ReportStatus } from '@prisma/client';
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

export class AdminReportDetailDto extends AdminReportDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  adminNote!: string | null;
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
