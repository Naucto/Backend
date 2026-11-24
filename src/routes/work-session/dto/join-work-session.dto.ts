import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsUUID } from 'class-validator';

import { WebRTCOfferDto } from '../../../webrtc/webrtc.dto';

export class JoinWorkSessionDto {
  @ApiProperty({
    description: 'The unique room ID for the work session',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  roomId!: string;

  @ApiProperty({
    description: "The user ID of the session's host",
    format: 'uuid',
    example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b',
  })
  @IsUUID()
  hostId!: string;

  @ApiProperty({
    type: () => WebRTCOfferDto,
    description: 'The WebRTC offer given to the client',
  })
  @Type(() => WebRTCOfferDto)
  webrtcOffer!: WebRTCOfferDto;
}
