import { ApiProperty } from "@nestjs/swagger";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";
import { IsUUID } from "class-validator";
import { Type } from "class-transformer";

export class JoinWorkSessionDto {
  @IsUUID()
    roomId!: string;

  @ApiProperty({ type: () => WebRTCOfferDto })
  @Type(() => WebRTCOfferDto)
    offer!: WebRTCOfferDto;
};
