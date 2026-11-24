import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

import { WebRTCOfferDto } from '../../../webrtc/webrtc.dto';

// Everything a client needs to open its WebRTC connection to the synced game-table server.
export class GameSessionConnectionResponseDto {
  @ApiProperty()
  @IsUUID()
  sessionUuid!: string;

  // The number this client plays under — its account's player number, or a synthetic one for an
  // editor self-join. Clients must use it as net.id(); it is never an account id.
  @ApiProperty({
    type: 'integer',
    description:
      'Player number assigned to this connection: what the game reads as net.id(), never an account id',
  })
  @IsInt()
  playerId!: number;

  @ApiProperty({ type: () => WebRTCOfferDto })
  @Type(() => WebRTCOfferDto)
  webrtcConfig!: WebRTCOfferDto;

  @ApiProperty({
    description: 'Short-lived signed ticket presented on the WebRTC connection',
  })
  @IsString()
  connectionTicket!: string;

  @ApiPropertyOptional({
    description: 'Join code to share, present only when hosting an INVITE_CODE session',
  })
  @IsOptional()
  @IsString()
  joinCode?: string;
}
