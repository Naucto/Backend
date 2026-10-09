import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GameSessionVisibility } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import {
  SESSION_MAX_PLAYERS,
  SESSION_MIN_PLAYERS,
  SESSION_TITLE_MAX_LENGTH,
  SESSION_TITLE_MIN_LENGTH,
} from './game-session-limits';

export class CreateGameSessionDto {
  @ApiProperty({ description: 'ID of the project this session is played on' })
  @IsInt()
  projectId!: number;

  @ApiProperty({ description: 'Human-readable title of the session' })
  @IsString()
  @Length(SESSION_TITLE_MIN_LENGTH, SESSION_TITLE_MAX_LENGTH)
  title!: string;

  @ApiProperty({
    description: 'Maximum number of players, host included',
    minimum: SESSION_MIN_PLAYERS,
    maximum: SESSION_MAX_PLAYERS,
  })
  @IsInt()
  @Min(SESSION_MIN_PLAYERS)
  @Max(SESSION_MAX_PLAYERS)
  maxPlayers!: number;

  @ApiProperty({ enum: GameSessionVisibility })
  @IsEnum(GameSessionVisibility)
  visibility!: GameSessionVisibility;

  @ApiPropertyOptional({
    description:
      'Set by the game editor when it hosts to test its own game, so the session is not counted as a real game',
  })
  @IsOptional()
  @IsBoolean()
  editorTest?: boolean;
}
