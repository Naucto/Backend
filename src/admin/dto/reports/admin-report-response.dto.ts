import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ReportStatus, ReportTargetType } from "@prisma/client";
import { PaginatedMetaDto } from "../admin-pagination.dto";

export class AdminReportResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty({ enum: ReportTargetType }) targetType!: ReportTargetType;
  @ApiProperty() targetId!: number;
  @ApiProperty() targetLabel!: string;
  @ApiProperty() reporterId!: number;
  @ApiPropertyOptional() reporterUsername?: string;
  @ApiProperty() reason!: string;
  @ApiPropertyOptional({ nullable: true }) details?: string | null;
  @ApiProperty({ enum: ReportStatus }) status!: ReportStatus;
  @ApiPropertyOptional({ nullable: true }) resolutionNote?: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) resolvedById?: number | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class AdminReportListResponseDto {
  @ApiProperty({ type: [AdminReportResponseDto] })
  data!: AdminReportResponseDto[];

  @ApiProperty({ type: PaginatedMetaDto })
  meta!: PaginatedMetaDto;
}

export class AdminReportDetailDto extends AdminReportResponseDto {
  @ApiProperty({ type: Object, isArray: true })
  moderationActions!: Array<Record<string, unknown>>;
}
