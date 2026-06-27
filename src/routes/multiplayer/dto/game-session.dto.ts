import { ApiProperty } from "@nestjs/swagger";
import { GameSessionVisibility } from "@prisma/client";
import { IsArray, IsEnum, IsInt, IsString, IsUUID } from "class-validator";

export class GameSessionResponseDto {
  @ApiProperty()
  @IsUUID()
  sessionUuid!: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty({ enum: GameSessionVisibility })
  @IsEnum(GameSessionVisibility)
  visibility!: GameSessionVisibility;

  @ApiProperty({ description: "ID of the host user" })
  @IsInt()
  hostId!: number;

  @ApiProperty({ description: "Maximum number of players, host included" })
  @IsInt()
  maxPlayers!: number;

  @ApiProperty({ description: "Current number of players, host included" })
  @IsInt()
  playerCount!: number;
}

export class GameSessionListResponseDto {
  @ApiProperty({ type: () => [GameSessionResponseDto] })
  @IsArray()
  sessions!: GameSessionResponseDto[];
}
