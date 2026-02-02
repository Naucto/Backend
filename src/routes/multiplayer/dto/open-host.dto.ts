import { GameSessionVisibility } from "@prisma/client";
import { IsEnum, IsInt, IsUUID } from "class-validator";

export class OpenHostRequestDto {
  @IsInt()
    projectId!: number;

  @IsEnum(GameSessionVisibility)
    visibility!: GameSessionVisibility;
};

export class OpenHostResponseDto {
  @IsUUID()
    sessionUuid!: string;
};
