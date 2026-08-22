import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";

export class JoinGameSessionDto {
  @ApiPropertyOptional({
    description: "Join code, required for INVITE_CODE sessions"
  })
  @IsOptional()
  @IsString()
    joinCode?: string;

  // Editor-only opt-in: lets a member rejoin their own session as a distinct
  // synthetic player to test multiplayer alone.
  @ApiPropertyOptional({
    description: "Set by the game editor to allow a self-join for solo testing"
  })
  @IsOptional()
  @IsBoolean()
    editorTest?: boolean;
}
