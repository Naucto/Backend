import { ApiProperty } from "@nestjs/swagger";
import { GameSessionVisibility } from "@prisma/client";
import { IsEnum, IsInt, IsString, Length, Min } from "class-validator";

export class CreateGameSessionDto {
  @ApiProperty({ description: "ID of the project this session is played on" })
  @IsInt()
    projectId!: number;

  @ApiProperty({ description: "Human-readable title of the session" })
  @IsString()
  @Length(1, 80)
    title!: string;

  @ApiProperty({
    description: "Maximum number of players, host included",
    minimum: 2
  })
  @IsInt()
  @Min(2)
    maxPlayers!: number;

  @ApiProperty({ enum: GameSessionVisibility })
  @IsEnum(GameSessionVisibility)
    visibility!: GameSessionVisibility;
}
