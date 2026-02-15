import { GameSessionVisibility } from "@prisma/client";
import { IsEnum, IsInt, IsUUID } from "class-validator";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";
import { Type } from "class-transformer";

export class OpenHostRequestDto {
  @IsInt()
    projectId!: number;

  @IsEnum(GameSessionVisibility)
    visibility!: GameSessionVisibility;
};

export class OpenHostResponseDto {
  @IsUUID()
    sessionUuid!: string;

  @Type(() => WebRTCOfferDto)
    webrtcConfig!: WebRTCOfferDto;
};
