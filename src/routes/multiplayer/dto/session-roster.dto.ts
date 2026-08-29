import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, Min } from "class-validator";

/** One person in a session. */
export class SessionPlayerDto {
  @ApiProperty({ description: "User ID", example: 42 })
    userId!: number;

  @ApiProperty({ description: "Username", example: "alice" })
    username!: string;

  @ApiPropertyOptional({
    description: "Display nickname, if set",
    type: String,
    nullable: true
  })
    nickname?: string | null;

  @ApiProperty({ description: "Whether this player is hosting", example: false })
    host!: boolean;
}

/**
 * Who is actually in a session. The NET panel had no way to name anyone who joined from outside
 * the work session, so external players rendered as "user 42".
 */
export class SessionRosterResponseDto {
  @ApiProperty({ type: [SessionPlayerDto] })
    players!: SessionPlayerDto[];

  @ApiProperty({ description: "Slots the session was opened with", example: 4 })
    maxPlayers!: number;
}

export class InviteToSessionDto {
  @ApiProperty({ description: "Who to invite", example: 42 })
  @IsInt()
  @Min(1)
    userId!: number;
}
