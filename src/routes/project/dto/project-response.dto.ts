import { ApiProperty } from "@nestjs/swagger";
import { ProjectStatus, MonetizationType } from "@prisma/client";

export class UserBasicInfoDto {
  @ApiProperty({
    example: 1,
    description: "The unique identifier of the user"
  })
  id!: number;

  @ApiProperty({
    example: "john_doe",
    description: "The username"
  })
  username!: string;

  @ApiProperty({
    example: "john.doe@example.com",
    description: "The email address"
  })
  email!: string;
}

export class ProjectResponseDto {
  @ApiProperty({
    example: 1,
    description: "The unique identifier of the project"
  })
  id!: number;

  @ApiProperty({
    description: "The name of the project",
    example: "MySuperVideoGame"
  })
  name!: string;

  @ApiProperty({
    description: "A short description of the project",
    example: "A 2D platformer game with pixel art graphics"
  })
  shortDesc!: string;

  @ApiProperty({
    description: "A detailed description of the project",
    example: "This game features multiple levels, power-ups, and boss fights.",
    nullable: true
  })
  longDesc?: string | null;

  @ApiProperty({
    description: "URL to the project icon",
    example: "https://example.com/icons/MySuperVideoGame.png",
    nullable: true
  })
  iconUrl?: string | null;

  @ApiProperty({
    description: "The current status of the project",
    enum: ProjectStatus,
    example: ProjectStatus.IN_PROGRESS,
    nullable: true
  })
  status?: ProjectStatus | null;

  @ApiProperty({
    description: "The monetization strategy for this project",
    enum: MonetizationType,
    example: MonetizationType.NONE,
    nullable: true
  })
  monetization?: MonetizationType | null;

  @ApiProperty({
    example: 99.99,
    description: "The price of the project, if applicable",
    nullable: true
  })
  price?: number | null;

  @ApiProperty({
    example: 1,
    description: "The ID of the user who owns this project"
  })
  userId!: number;

  @ApiProperty({
    example: "2023-04-15T12:00:00Z",
    description: "The date and time when the project was created"
  })
  createdAt!: Date;

  @ApiProperty({
    example: 123,
    description:
      "The number of unique players who have interacted with this project"
  })
  uniquePlayers!: number;

  @ApiProperty({
    example: 42,
    description: "The number of currently active players in this project"
  })
  activePlayers!: number;

  @ApiProperty({
    example: 87,
    description: "The number of likes received by the project"
  })
  likes!: number;
}

export class ProjectWithRelationsResponseDto extends ProjectResponseDto {
  @ApiProperty({
    description: "The users collaborating on this project",
    type: [UserBasicInfoDto]
  })
  collaborators!: UserBasicInfoDto[];

  @ApiProperty({
    description: "The creator of this project",
    type: UserBasicInfoDto
  })
  creator!: UserBasicInfoDto;
}

export class CdnUrlResponseDto {
  @ApiProperty({
    example: "https://cdn.example.com/files/project-123?signature=abc123",
    description: "The signed CDN URL for accessing the project file"
  })
  url!: string;
}

export class SignedUrlResponseDto {
  @ApiProperty({
    example:
      "https://cdn.example.com/files/project-123?Expires=1640995200&Signature=abc123",
    description: "The signed CloudFront URL for accessing the protected file"
  })
  signedUrl!: string;
}
