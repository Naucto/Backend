import { ApiProperty } from "@nestjs/swagger";
import { IsInt, IsOptional, IsPositive, IsString, MaxLength } from "class-validator";

export class ModerationReasonDto {
  @ApiProperty({
    required: false,
    description: "Free-form reason recorded in the audit log",
    maxLength: 500
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({
    required: false,
    description: "Optional related report id"
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  reportId?: number;
}
