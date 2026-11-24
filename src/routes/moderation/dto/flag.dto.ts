import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationReason, ModerationTargetType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { IsId } from '../../../common/decorators/is-id';
import { trimmed } from '../../reports/dto/report-transforms';

export const FLAG_DETAILS_MAX_LENGTH = 1_000;

/** What a person tells staff about one target. */
export class CreateFlagDto {
  @ApiProperty({ enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  @IsEnum(ModerationTargetType)
  targetType!: ModerationTargetType;

  @ApiProperty({
    format: 'uuid',
    description: 'The id of the target, of the kind `targetType` names',
  })
  @IsId()
  targetId!: string;

  @ApiProperty({ enum: ModerationReason, enumName: 'ModerationReason' })
  @IsEnum(ModerationReason)
  reason!: ModerationReason;

  @ApiPropertyOptional({ maxLength: FLAG_DETAILS_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(FLAG_DETAILS_MAX_LENGTH)
  details?: string;
}

export class CreatedFlagDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}
