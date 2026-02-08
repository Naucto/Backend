import { Type } from "class-transformer";
import { IsUUID } from "class-validator";
import { WebRTCOfferDTO } from "@common/dto/webrtc.dto";

export class JoinHostRequestDto {
  @IsUUID()
    sessionUuid!: string;

  @Type(() => WebRTCOfferDTO)
    webrtcConfig!: WebRTCOfferDTO;
};
