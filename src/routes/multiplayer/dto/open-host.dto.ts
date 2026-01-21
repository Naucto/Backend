import { IsInt } from "class-validator";

export class OpenHostRequestDto {
  @IsInt()
    projectId!: number;

  @IsInt()
    gameId!: number;
};
