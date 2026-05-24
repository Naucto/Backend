import { ApiProperty } from "@nestjs/swagger";
import { ReportTargetType } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength
} from "class-validator";

export class CreateReportDto {
  @ApiProperty({
    enum: ReportTargetType,
    example: ReportTargetType.PROJECT
  })
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @ApiProperty({ example: 123 })
  @IsInt()
  targetId!: number;

  @ApiProperty({
    example: "Harassment or hateful content",
    minLength: 3,
    maxLength: 120
  })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  reason!: string;

  @ApiProperty({
    example: "The comment contains direct personal attacks.",
    required: false,
    maxLength: 1000
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}
