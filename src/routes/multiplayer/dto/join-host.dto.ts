import { Type } from "class-transformer";
import { IsUUID } from "class-validator";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";

export class JoinHostRequestDto {
  @IsUUID()
    sessionUuid!: string;
};

export class JoinHostResponseDto {
  @Type(() => WebRTCOfferDto)
    webrtcConfig!: WebRTCOfferDto;
};
