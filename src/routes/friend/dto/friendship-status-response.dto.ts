import { ApiProperty } from "@nestjs/swagger";

export type FriendshipStatus = "NONE" | "REQUEST_SENT" | "REQUEST_RECEIVED" | "FRIENDS";

export class FriendshipStatusDto {
  @ApiProperty({ enum: ["NONE", "REQUEST_SENT", "REQUEST_RECEIVED", "FRIENDS"] })
    status!: FriendshipStatus;

  @ApiProperty({ example: 10, description: "Request ID (when REQUEST_SENT or REQUEST_RECEIVED)", nullable: true, type: Number })
    requestId!: number | null;

  @ApiProperty({ example: 42, description: "Friendship ID (when FRIENDS)", nullable: true, type: Number })
    friendshipId!: number | null;
}

export class FriendshipStatusResponseDto {
  @ApiProperty({ example: 200 })
    statusCode!: number;

  @ApiProperty({ example: "Friendship status retrieved successfully" })
    message!: string;

  @ApiProperty({ type: FriendshipStatusDto })
    data!: FriendshipStatusDto;
}
