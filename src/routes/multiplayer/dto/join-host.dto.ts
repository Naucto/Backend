import { Type } from "class-transformer";
import { IsUUID } from "class-validator";
import { WebRTCOfferDto } from "@common/dto/webrtc.dto";

export class JoinHostRequestDto {
  @IsUUID()
    sessionUuid!: string;
};

export class JoinHostResponseDto {
  @Type(() => WebRTCOfferDto)
    webrtcConfig!: WebRTCOfferDto;
};
