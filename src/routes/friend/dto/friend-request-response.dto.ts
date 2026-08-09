import { ApiProperty } from "@nestjs/swagger";
import { FriendUserInfoDto } from "./friend-response.dto";

export class FriendRequestResponseDto {
  @ApiProperty({ example: 10, description: "Friend request ID" })
    id!: number;

  @ApiProperty({ type: FriendUserInfoDto })
    from!: FriendUserInfoDto;

  @ApiProperty({ type: FriendUserInfoDto })
    to!: FriendUserInfoDto;

  @ApiProperty({ example: "2024-01-01T00:00:00.000Z" })
    createdAt!: string;
}

export class FriendRequestListResponseDto {
  @ApiProperty({ example: 200 })
    statusCode!: number;

  @ApiProperty({ example: "Friend requests retrieved successfully" })
    message!: string;

  @ApiProperty({ type: [FriendRequestResponseDto] })
    data!: FriendRequestResponseDto[];
}

export class FriendRequestSingleResponseDto {
  @ApiProperty({ example: 200 })
    statusCode!: number;

  @ApiProperty({ example: "Friend request sent successfully" })
    message!: string;

  @ApiProperty({ type: FriendRequestResponseDto })
    data!: FriendRequestResponseDto;
}
