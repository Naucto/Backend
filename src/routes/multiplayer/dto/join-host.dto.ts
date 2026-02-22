import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsUUID } from "class-validator";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";

export class JoinHostRequestDto {
  @ApiProperty()
  @IsUUID()
    sessionUuid!: string;
};

export class JoinHostResponseDto {
  @ApiProperty({ type: () => WebRTCOfferDto })
  @Type(() => WebRTCOfferDto)
    webrtcConfig!: WebRTCOfferDto;
};
