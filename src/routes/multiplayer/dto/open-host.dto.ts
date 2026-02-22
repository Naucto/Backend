import { ApiProperty } from "@nestjs/swagger";
import { GameSessionVisibility } from "@prisma/client";
import { IsEnum, IsInt, IsUUID } from "class-validator";
import { WebRTCOfferDto } from "@webrtc/webrtc.dto";
import { Type } from "class-transformer";

export class OpenHostRequestDto {
  @ApiProperty()
  @IsInt()
    projectId!: number;

  @ApiProperty({ enum: GameSessionVisibility })
  @IsEnum(GameSessionVisibility)
    visibility!: GameSessionVisibility;
};

export class OpenHostResponseDto {
  @ApiProperty()
  @IsUUID()
    sessionUuid!: string;

  @ApiProperty({ type: () => WebRTCOfferDto })
  @Type(() => WebRTCOfferDto)
    webrtcConfig!: WebRTCOfferDto;
};
