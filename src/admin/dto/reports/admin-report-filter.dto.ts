import { ApiPropertyOptional } from "@nestjs/swagger";
import { ReportStatus, ReportTargetType } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional
} from "class-validator";
import { AdminPaginationDto } from "../admin-pagination.dto";

export class AdminReportFilterDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  targetId?: number;

  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  reporterId?: number;

  @ApiPropertyOptional({ enum: ["id", "createdAt", "updatedAt", "status"] })
  @IsOptional()
  @IsIn(["id", "createdAt", "updatedAt", "status"])
  override sortBy?: string;
}
