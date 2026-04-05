import { ApiProperty } from "@nestjs/swagger";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";
import { IsNumber, IsUUID } from "class-validator";
import { Type } from "class-transformer";

export class JoinWorkSessionDto {
  @ApiProperty({
    description: "The unique room ID for the work session",
    example: "550e8400-e29b-41d4-a716-446655440000"
  })
  @IsUUID()
    roomId!: string;

  @ApiProperty({
    description: "The user ID of the session's host",
    example: 1
  })
  @IsNumber()
    hostId!: number;

  @ApiProperty({
    type: () => WebRTCOfferDto,
    description: "The WebRTC offer given to the client"
  })
  @Type(() => WebRTCOfferDto)
    webrtcOffer!: WebRTCOfferDto;
};
