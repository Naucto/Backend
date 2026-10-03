import { ApiPropertyOptional } from '@nestjs/swagger';
import { PersonalColour } from '@prisma/client';
import { IsEnum, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

import {
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  HANDLE_PATTERN_MESSAGE,
} from '../../../auth/handle-policy';

export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description: 'Display name shown on the profile',
    example: 'Jojo',
    maxLength: 160,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(160)
  nickname?: string;
  @ApiPropertyOptional({
    description: 'Public profile description displayed on the profile',
    example: 'I love making games',
    maxLength: 160,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(160)
  description?: string;

  @ApiPropertyOptional({
    description: 'Handle, unique across the platform — people add you as a friend with it',
    example: 'louis',
    minLength: HANDLE_MIN,
    maxLength: HANDLE_MAX,
    pattern: HANDLE_PATTERN.source,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(HANDLE_MIN)
  @MaxLength(HANDLE_MAX)
  @Matches(HANDLE_PATTERN, { message: HANDLE_PATTERN_MESSAGE })
  username?: string;

  @ApiPropertyOptional({
    description: 'The accent this person is drawn in',
    enum: PersonalColour,
    example: PersonalColour.SKY,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(PersonalColour)
  colour?: PersonalColour;
}
