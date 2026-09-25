import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  ModerationActionType,
  ModerationTargetType
} from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString
} from "class-validator";
import { PaginationDto } from "@common/dto/pagination.dto";

export class ModerationLogFilterDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
    actorId?: number;

  @ApiPropertyOptional({ enum: ModerationTargetType })
  @IsOptional()
  @IsEnum(ModerationTargetType)
    targetType?: ModerationTargetType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
    targetId?: number;

  @ApiPropertyOptional({ enum: ModerationActionType })
  @IsOptional()
  @IsEnum(ModerationActionType)
    action?: ModerationActionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
    createdAfter?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
    createdBefore?: string;
}
