import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ModerationReason } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { trimmed } from '../../reports/dto/report-transforms';

export const PUBLIC_MESSAGE_MAX_LENGTH = 1_000;
export const INTERNAL_NOTE_MAX_LENGTH = 2_000;
export const SUSPENSION_MAX_DAYS = 365;

export const PROFILE_PARTS = ['NICKNAME', 'DESCRIPTION', 'PICTURE', 'BACKGROUND'] as const;
export type ProfilePart = (typeof PROFILE_PARTS)[number];

export class InternalNoteDto {
  @ApiPropertyOptional({ description: 'What only staff read', maxLength: INTERNAL_NOTE_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(INTERNAL_NOTE_MAX_LENGTH)
  internalNote?: string;
}

/** Lifting an earlier decision: a restore or a reinstatement. */
export class ModerationNoteDto extends InternalNoteDto {
  @ApiPropertyOptional({
    description: 'What the affected account is told',
    maxLength: PUBLIC_MESSAGE_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(PUBLIC_MESSAGE_MAX_LENGTH)
  publicMessage?: string;
}

export class DecisionDto extends InternalNoteDto {
  @ApiProperty({ enum: ModerationReason, enumName: 'ModerationReason' })
  @IsEnum(ModerationReason)
  reason!: ModerationReason;

  @ApiPropertyOptional({
    default: true,
    description: 'Also closes the open flags on the target, as acted on',
  })
  @IsOptional()
  @IsBoolean()
  resolveFlags?: boolean;
}

/** Hiding or deleting a game or a comment. */
export class ContentDecisionDto extends DecisionDto {
  @ApiPropertyOptional({
    description: 'What the owner is told',
    maxLength: PUBLIC_MESSAGE_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(PUBLIC_MESSAGE_MAX_LENGTH)
  publicMessage?: string;
}

export class WarnAccountDto extends DecisionDto {
  @ApiProperty({
    description: 'What the account is told',
    minLength: 1,
    maxLength: PUBLIC_MESSAGE_MAX_LENGTH,
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(PUBLIC_MESSAGE_MAX_LENGTH)
  publicMessage!: string;
}

export class SuspendAccountDto extends WarnAccountDto {
  @ApiPropertyOptional({
    description: 'How long it lasts. Left out, it lasts until staff reinstate the account.',
    minimum: 1,
    maximum: SUSPENSION_MAX_DAYS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(SUSPENSION_MAX_DAYS)
  durationDays?: number;
}

export class ClearProfileDto extends ContentDecisionDto {
  @ApiProperty({
    enum: PROFILE_PARTS,
    enumName: 'ProfilePart',
    isArray: true,
    description: 'What to clear of the profile',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(PROFILE_PARTS, { each: true })
  parts!: ProfilePart[];
}

export class StaffDeleteAccountDto extends DecisionDto {
  @ApiProperty({ description: 'Must be the literal string DELETE', enum: ['DELETE'] })
  @Equals('DELETE')
  confirmation!: 'DELETE';

  @ApiProperty({
    description: 'Whether the published games of the account go too, or stay without an author',
  })
  @IsBoolean()
  removePublishedGames!: boolean;
}
