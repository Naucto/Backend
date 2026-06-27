import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsOptional, IsString, IsUUID } from "class-validator";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";

// Returned on create/join: everything a client needs to open its WebRTC
// connection to the synced game-table server.
export class GameSessionConnectionResponseDto {
  @ApiProperty()
  @IsUUID()
    sessionUuid!: string;

  @ApiProperty({ type: () => WebRTCOfferDto })
  @Type(() => WebRTCOfferDto)
    webrtcConfig!: WebRTCOfferDto;

  @ApiProperty({
    description: "Short-lived signed ticket presented on the WebRTC connection"
  })
  @IsString()
    connectionTicket!: string;

  @ApiPropertyOptional({
    description: "Join code to share, present only when hosting an INVITE_CODE session"
  })
  @IsOptional()
  @IsString()
    joinCode?: string;
};
