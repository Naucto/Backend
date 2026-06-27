import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

export class JoinGameSessionDto {
  @ApiPropertyOptional({
    description: "Join code, required for INVITE_CODE sessions"
  })
  @IsOptional()
  @IsString()
    joinCode?: string;
};
