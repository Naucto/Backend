import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsString, Length, Matches, Min, ValidateIf } from 'class-validator';

import {
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  HANDLE_PATTERN_MESSAGE,
} from '../../../auth/handle-policy';
import { FRIEND_CODE_INPUT_MAX, FRIEND_CODE_LENGTH } from '../../user/friend-code.util';

export class SendFriendRequestDto {
  @ApiPropertyOptional({ description: 'ID of the user to befriend' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({
    description: 'Handle of the person to befriend — what the profile shows after the @',
    example: 'louis',
    minLength: HANDLE_MIN,
    maxLength: HANDLE_MAX,
    pattern: HANDLE_PATTERN.source,
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(HANDLE_MIN, HANDLE_MAX)
  @Matches(HANDLE_PATTERN, { message: HANDLE_PATTERN_MESSAGE })
  username?: string;

  @ApiPropertyOptional({
    description: 'Friend code of the user to befriend (case-insensitive, dashes/spaces ignored)',
    example: '7K3Q-W9ZB',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(FRIEND_CODE_LENGTH, FRIEND_CODE_INPUT_MAX)
  friendCode?: string;
}
