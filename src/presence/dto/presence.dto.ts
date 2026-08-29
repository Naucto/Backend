import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PRESENCE_KINDS, PresenceKind } from "../presence.types";

export class PresenceDto {
  @ApiProperty({ example: 1 })
    userId!: number;

  @ApiProperty({ example: "louis", description: "Who it is, so a row can name them without a second call" })
    username!: string;

  @ApiPropertyOptional({ nullable: true, example: "Louis" })
    nickname?: string | null;

  @ApiProperty({ enum: PRESENCE_KINDS, enumName: "PresenceKind" })
    kind!: PresenceKind;

  @ApiPropertyOptional({ nullable: true, description: "Released project being played (PLAYING)" })
    releaseId?: number | null;

  @ApiPropertyOptional({ nullable: true, description: "Project being edited (BUILDING) or hosted (HOSTING)" })
    projectId?: number | null;

  @ApiPropertyOptional({ nullable: true, description: "Game session UUID (HOSTING)" })
    sessionId?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "Game session title or project name" })
    title?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "Cover of the game being played, built or hosted" })
    coverUrl?: string | null;

  @ApiPropertyOptional({ nullable: true, description: "Players in the hosted session, host included" })
    players?: number | null;

  @ApiPropertyOptional({ nullable: true })
    maxPlayers?: number | null;

  @ApiPropertyOptional({ description: "Whether the caller may join the hosted session" })
    joinable?: boolean;

  @ApiProperty({ description: "When this activity started (ISO 8601)", example: "2026-06-07T09:00:00.000Z" })
    since!: string;
}
