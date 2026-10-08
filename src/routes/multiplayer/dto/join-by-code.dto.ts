import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

import { JOIN_CODE_INPUT_MAX_LENGTH } from './game-session-limits';

export class JoinByCodeDto {
  @ApiProperty({ description: 'Invite code of the session to join' })
  @IsString()
  @Length(1, JOIN_CODE_INPUT_MAX_LENGTH)
  joinCode!: string;

  @ApiPropertyOptional({
    description: 'Set by the game editor to allow a self-join for solo testing',
  })
  @IsOptional()
  @IsBoolean()
  editorTest?: boolean;
}
