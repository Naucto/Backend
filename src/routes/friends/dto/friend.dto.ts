import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class UserSummaryDto {
  @ApiProperty({ example: 1 })
    id!: number;

  @ApiProperty({ example: "xX_DarkGamer_Xx" })
    username!: string;

  @ApiPropertyOptional({ nullable: true, example: "JohnDoe" })
    nickname?: string | null;
}

export class FriendDto extends UserSummaryDto {
  @ApiProperty({
    description: "When the friendship was created (ISO 8601)",
    example: "2026-06-07T09:00:00.000Z"
  })
    since!: string;
}

export class FriendRequestDto {
  @ApiProperty({ example: 12 })
    id!: number;

  @ApiProperty({ type: () => UserSummaryDto })
    from!: UserSummaryDto;

  @ApiProperty({ type: () => UserSummaryDto })
    to!: UserSummaryDto;

  @ApiPropertyOptional({
    description: "Friends the two users have in common"
  })
    mutuals?: number;

  @ApiPropertyOptional({
    description: "Whether the sender has played a game session hosted on one of the recipient's projects"
  })
    playedYourGame?: boolean;

  @ApiProperty({ example: "2026-06-07T09:00:00.000Z" })
    createdAt!: string;
}

export class RecentPlayerDto extends UserSummaryDto {
  @ApiProperty({ description: "Name of the game played together" })
    game!: string;

  @ApiProperty({
    description: "Start of the most recent shared game session (ISO 8601)",
    example: "2026-06-07T09:00:00.000Z"
  })
    playedAt!: string;

  @ApiProperty({ description: "Whether this player is already a friend" })
    friend!: boolean;
}

export const FRIENDSHIP_STATUSES = ["NONE", "PENDING", "FRIENDS"] as const;
export type FriendshipStatus = (typeof FRIENDSHIP_STATUSES)[number];

export class FriendshipStatusDto {
  @ApiProperty({ enum: FRIENDSHIP_STATUSES, enumName: "FriendshipStatus" })
    status!: FriendshipStatus;
}
