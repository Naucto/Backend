import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class PublicUserProfileDto {
  @ApiProperty({ description: "User ID", example: 1 })
    id!: number;

  @ApiProperty({ description: "Username", example: "xX_DarkGamer_Xx" })
    username!: string;

  @ApiPropertyOptional({
    description: "User nickname / bio",
    example: "JohnDoe",
    type: String,
    nullable: true
  })
    nickname?: string | null;

  @ApiPropertyOptional({
    description: "User profile description",
    example: "I love making games",
    type: String,
    nullable: true
  })
    description?: string | null;

  @ApiPropertyOptional({
    description: "Public CDN URL of the profile image (if any)",
    example: "https://cdn.example.com/users/1/profile?v=abc123",
    type: String,
    nullable: true
  })
    profileImageUrl?: string | null;

  @ApiPropertyOptional({
    description: "Public CDN URL of the profile background image (if any)",
    example: "https://cdn.example.com/users/1/background?v=abc123",
    type: String,
    nullable: true
  })
    backgroundImageUrl?: string | null;

  @ApiProperty({
    description: "When the account was created — the profile header shows the year",
    example: "2025-03-14T09:00:00.000Z"
  })
    createdAt!: Date;

  @ApiPropertyOptional({ description: "Published games this person owns", example: 7 })
    gameCount?: number;

  @ApiPropertyOptional({
    description: "Total plays across their published games",
    example: 12400
  })
    totalPlays?: number;

  @ApiPropertyOptional({
    description: "Total likes across their published games",
    example: 318
  })
    totalLikes?: number;
}
