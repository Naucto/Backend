import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GameSessionVisibility } from '@prisma/client';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

import { DiskStyleDto } from '../../project/dto/disk-style.dto';
import { SESSION_ROSTER_PREVIEW } from './game-session-limits';

export class GameSessionRosterEntryDto {
  @ApiProperty({
    description: 'User ID',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  @IsUUID()
  id!: string;

  @ApiProperty({ example: 'alice' })
  @IsString()
  username!: string;

  @ApiPropertyOptional({ description: 'Display nickname, if set' })
  @IsOptional()
  @IsString()
  nickname?: string;
}

export class GameSessionResponseDto {
  @ApiProperty()
  @IsUUID()
  sessionUuid!: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty({ enum: GameSessionVisibility })
  @IsEnum(GameSessionVisibility)
  visibility!: GameSessionVisibility;

  @ApiProperty({
    description: 'ID of the host user',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  @IsUUID()
  hostId!: string;

  @ApiProperty({ description: 'Username of the host' })
  @IsString()
  hostUsername!: string;

  @ApiPropertyOptional({ description: 'Display nickname of the host, if set' })
  @IsOptional()
  @IsString()
  hostNickname?: string;

  @ApiProperty({
    description: 'ID of the game (project) being played',
    format: 'uuid',
    example: '8c5d2a7e-41b3-4f6a-9e0d-2b7c6a5f4e3d',
  })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ description: 'Name of the game (project) being played' })
  @IsString()
  projectName!: string;

  @ApiProperty({ description: 'Maximum number of players, host included' })
  @IsInt()
  maxPlayers!: number;

  @ApiProperty({ description: 'Current number of players, host included' })
  @IsInt()
  playerCount!: number;

  @ApiProperty({ description: 'When the session was opened', example: '2026-11-20T18:30:00Z' })
  startedAt!: Date;

  @ApiProperty({
    type: [GameSessionRosterEntryDto],
    description: 'Who is in the session, host first',
    maxItems: SESSION_ROSTER_PREVIEW,
  })
  @IsArray()
  roster!: GameSessionRosterEntryDto[];

  @ApiProperty({
    description: 'Address of the cover of the game, usable as is; null without a cover',
    type: String,
    nullable: true,
  })
  coverUrl!: string | null;

  @ApiProperty({
    description:
      'The disk the author of the game chose. Null when none was chosen: a client then derives a colour from the project id',
    type: DiskStyleDto,
    nullable: true,
  })
  disk!: DiskStyleDto | null;
}

export class GameSessionListResponseDto {
  @ApiProperty({ type: () => [GameSessionResponseDto] })
  @IsArray()
  sessions!: GameSessionResponseDto[];
}
