import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class JoinGameSessionDto {
  @ApiPropertyOptional({
    description: 'Join code, required for INVITE_CODE sessions',
  })
  @IsOptional()
  @IsString()
  joinCode?: string;

  @ApiPropertyOptional({
    description: 'Set by the game editor to allow a self-join for solo testing',
  })
  @IsOptional()
  @IsBoolean()
  editorTest?: boolean;
}
