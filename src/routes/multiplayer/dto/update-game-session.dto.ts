import { ApiPropertyOptional } from "@nestjs/swagger";
import { GameSessionVisibility } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min
} from "class-validator";

export class UpdateGameSessionDto {
  @ApiPropertyOptional({ description: "New title of the session" })
  @IsOptional()
  @IsString()
  @Length(1, 80)
    title?: string;

  @ApiPropertyOptional({
    description: "New maximum number of players, host included",
    minimum: 2,
    maximum: 16
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(16)
    maxPlayers?: number;

  @ApiPropertyOptional({ enum: GameSessionVisibility })
  @IsOptional()
  @IsEnum(GameSessionVisibility)
    visibility?: GameSessionVisibility;
}
