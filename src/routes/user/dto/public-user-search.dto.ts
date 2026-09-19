import { ApiProperty } from "@nestjs/swagger";

/** One person in a search result: enough to recognise them and open their profile. */
export class PublicUserSearchHitDto {
  @ApiProperty({ description: "User ID", example: 12 })
    id!: number;

  @ApiProperty({ description: "Handle, unique across the platform", example: "louis" })
    username!: string;

  @ApiProperty({
    description: "Display name",
    example: "Louis",
    nullable: true,
    required: false
  })
    nickname!: string | null;

  @ApiProperty({
    description: "Profile picture, null when the person has not set one",
    example: "https://cdn.example/users/12/profile?v=abc",
    nullable: true,
    required: false
  })
    profileImageUrl!: string | null;
}

export class PublicUserSearchResponseDto {
  @ApiProperty({ description: "HTTP status code", example: 200 })
    statusCode!: number;

  @ApiProperty({ description: "Response message", example: "Users retrieved successfully" })
    message!: string;

  @ApiProperty({ description: "Matching people", type: [PublicUserSearchHitDto] })
    data!: PublicUserSearchHitDto[];
}
