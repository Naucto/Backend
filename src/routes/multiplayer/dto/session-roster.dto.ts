import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionPlayerDto {
  @ApiProperty({
    description: 'User ID',
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  userId!: string;

  @ApiProperty({ description: 'Username', example: 'alice' })
  username!: string;

  @ApiPropertyOptional({
    description: 'Display nickname, if set',
    type: String,
    nullable: true,
  })
  nickname?: string | null;

  @ApiProperty({ description: 'Whether this player is hosting', example: false })
  host!: boolean;
}

export class SessionRosterResponseDto {
  @ApiProperty({ type: [SessionPlayerDto] })
  players!: SessionPlayerDto[];

  @ApiProperty({ description: 'Slots the session was opened with', example: 4 })
  maxPlayers!: number;
}
