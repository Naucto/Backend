import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Length } from "class-validator";

export class JoinByCodeDto {
  @ApiProperty({ description: "Invite code of the session to join" })
  @IsString()
  @Length(1, 16)
    joinCode!: string;

  // Editor-only opt-in: lets a member rejoin their own session as a distinct
  // synthetic player to test multiplayer alone.
  @ApiPropertyOptional({
    description: "Set by the game editor to allow a self-join for solo testing"
  })
  @IsOptional()
  @IsBoolean()
    editorTest?: boolean;
}
