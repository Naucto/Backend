import { ApiProperty } from "@nestjs/swagger";

export class FriendCountDto {
  @ApiProperty({ example: 5, description: "Number of friends" })
    count!: number;
}

export class FriendCountResponseDto {
  @ApiProperty({ example: 200 })
    statusCode!: number;

  @ApiProperty({ example: "Friend count retrieved successfully" })
    message!: string;

  @ApiProperty({ type: FriendCountDto })
    data!: FriendCountDto;
}
