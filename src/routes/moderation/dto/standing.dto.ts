import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationActionType, ModerationReason, ModerationTargetType } from '@prisma/client';

import { SuspensionDto } from '../../user/dto/suspension.dto';

/** The suspension an account is under, with what it was told about it. */
export class StandingSuspensionDto extends SuspensionDto {
  @ApiPropertyOptional({ enum: ModerationReason, enumName: 'ModerationReason', nullable: true })
  reason!: ModerationReason | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  message!: string | null;
}

/** One moderation action as the account it bore on reads it: never who took it, nor who reported. */
export class StandingEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ModerationActionType, enumName: 'ModerationActionType' })
  action!: ModerationActionType;

  @ApiProperty({ enum: ModerationTargetType, enumName: 'ModerationTargetType' })
  targetType!: ModerationTargetType;

  @ApiProperty({ format: 'uuid' })
  targetId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'What the target was called when the action was taken: its name or its title, else the start of its text. It may be gone since.',
  })
  targetLabel!: string | null;

  @ApiPropertyOptional({ enum: ModerationReason, enumName: 'ModerationReason', nullable: true })
  reason!: ModerationReason | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'What staff told the account' })
  message!: string | null;

  @ApiPropertyOptional({ type: Date, nullable: true, description: 'When a suspension ends' })
  expiresAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

/** Where an account stands with moderation, and what led there, newest first. */
export class StandingDto {
  @ApiPropertyOptional({ type: StandingSuspensionDto, nullable: true })
  suspension!: StandingSuspensionDto | null;

  @ApiProperty({ description: 'How many warnings the account has received' })
  warnings!: number;

  @ApiProperty({ type: [StandingEntryDto] })
  items!: StandingEntryDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
