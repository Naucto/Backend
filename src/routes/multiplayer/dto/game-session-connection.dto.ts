import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID } from "class-validator";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";

// Returned on create/join: everything a client needs to open its WebRTC
// connection to the synced game-table server.
export class GameSessionConnectionResponseDto {
  @ApiProperty()
  @IsUUID()
    sessionUuid!: string;

  // The id this client plays under — its real user id, or a synthetic one for an
  // editor self-join. Clients must use it (not their account id) as net.id().
  @ApiProperty({ description: "Player id assigned to this connection" })
  @IsInt()
    playerId!: number;

  @ApiProperty({ type: () => WebRTCOfferDto })
  @Type(() => WebRTCOfferDto)
    webrtcConfig!: WebRTCOfferDto;

  @ApiProperty({
    description: "Short-lived signed ticket presented on the WebRTC connection"
  })
  @IsString()
    connectionTicket!: string;

  @ApiPropertyOptional({
    description:
      "Join code to share, present only when hosting an INVITE_CODE session"
  })
  @IsOptional()
  @IsString()
    joinCode?: string;
}
