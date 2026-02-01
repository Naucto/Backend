import { GameSessionVisibility } from "@prisma/client";
import { IsEnum, IsInt } from "class-validator";

export class OpenHostRequestDto {
  @IsInt()
    projectId!: number;

  @IsInt()
    gameId!: number;

  @IsEnum(GameSessionVisibility)
    visibility!: GameSessionVisibility;
};
