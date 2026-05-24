import { ApiProperty } from "@nestjs/swagger";
import { ReportStatus, ReportTargetType } from "@prisma/client";

export class ReportResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ enum: ReportTargetType })
  targetType!: ReportTargetType;

  @ApiProperty({ example: 123 })
  targetId!: number;

  @ApiProperty({ example: 42 })
  reporterId!: number;

  @ApiProperty({ example: "Harassment or hateful content" })
  reason!: string;

  @ApiProperty({ example: "More context from the reporter", nullable: true })
  details?: string | null;

  @ApiProperty({ enum: ReportStatus })
  status!: ReportStatus;

  @ApiProperty({ example: "2026-05-10T00:00:00.000Z" })
  createdAt!: Date;
}
