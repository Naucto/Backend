import { ApiPropertyOptional } from '@nestjs/swagger';
import { GameSessionVisibility } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import {
  SESSION_MAX_PLAYERS,
  SESSION_MIN_PLAYERS,
  SESSION_TITLE_MAX_LENGTH,
  SESSION_TITLE_MIN_LENGTH,
} from './game-session-limits';

export class UpdateGameSessionDto {
  @ApiPropertyOptional({ description: 'New title of the session' })
  @IsOptional()
  @IsString()
  @Length(SESSION_TITLE_MIN_LENGTH, SESSION_TITLE_MAX_LENGTH)
  title?: string;

  @ApiPropertyOptional({
    description: 'New maximum number of players, host included',
    minimum: SESSION_MIN_PLAYERS,
    maximum: SESSION_MAX_PLAYERS,
  })
  @IsOptional()
  @IsInt()
  @Min(SESSION_MIN_PLAYERS)
  @Max(SESSION_MAX_PLAYERS)
  maxPlayers?: number;

  @ApiPropertyOptional({ enum: GameSessionVisibility })
  @IsOptional()
  @IsEnum(GameSessionVisibility)
  visibility?: GameSessionVisibility;
}
