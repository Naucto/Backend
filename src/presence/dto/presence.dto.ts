import { ApiProperty } from '@nestjs/swagger';

import { PRESENCE_KINDS, PresenceKind, PresenceState } from '../presence.types';

export class PresenceDto implements PresenceState {
  @ApiProperty({ format: 'uuid', example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b' })
  userId!: string;

  @ApiProperty({
    example: 'louis',
    description: 'Who it is, so a row can name them without a second call',
  })
  username!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Louis' })
  nickname!: string | null;

  @ApiProperty({ enum: PRESENCE_KINDS, enumName: 'PresenceKind' })
  kind!: PresenceKind;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Released project being played (PLAYING)',
  })
  releaseId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Project being edited (BUILDING) or hosted (HOSTING)',
  })
  projectId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Game session UUID (HOSTING)' })
  sessionId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Game session title or project name',
  })
  title!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Cover of the game being played, built or hosted',
  })
  coverUrl!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Players in the hosted session, host included',
  })
  players!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  maxPlayers!: number | null;

  @ApiProperty({ description: 'Whether the caller may join the hosted session' })
  joinable!: boolean;

  @ApiProperty({
    description: 'When this activity started (ISO 8601)',
    example: '2026-06-07T09:00:00.000Z',
  })
  since!: string;
}
