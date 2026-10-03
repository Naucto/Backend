import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SessionPlayerDto {
  @ApiProperty({ description: 'User ID', example: 42 })
  userId!: number;

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
