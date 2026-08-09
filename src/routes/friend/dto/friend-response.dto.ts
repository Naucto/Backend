import { ApiProperty } from "@nestjs/swagger";

export class FriendUserInfoDto {
  @ApiProperty({ example: 1, description: "User ID" })
    id!: number;

  @ApiProperty({ example: "john_doe", description: "Username" })
    username!: string;

  @ApiProperty({ example: "John", description: "Nickname", nullable: true, type: String })
    nickname!: string | null;

  @ApiProperty({ example: "https://cdn.example.com/users/1/profile", nullable: true, type: String })
    profileImageUrl!: string | null;
}

export class FriendResponseDto {
  @ApiProperty({ example: 42, description: "Friendship ID" })
    friendshipId!: number;

  @ApiProperty({ type: FriendUserInfoDto })
    user!: FriendUserInfoDto;

  @ApiProperty({ example: "2024-01-01T00:00:00.000Z", description: "Date the friendship was created" })
    since!: string;
}

export class FriendListResponseDto {
  @ApiProperty({ example: 200 })
    statusCode!: number;

  @ApiProperty({ example: "Friends retrieved successfully" })
    message!: string;

  @ApiProperty({ type: [FriendResponseDto] })
    data!: FriendResponseDto[];
}
