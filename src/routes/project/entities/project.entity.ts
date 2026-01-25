import { ApiProperty } from "@nestjs/swagger";

export class Project {
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
    example: "This game features multiple levels, power-ups, and boss fights."
  })
  longDesc?: string;

  @ApiProperty({
    description: "URL to the project icon",
    example: "https://example.com/icons/MySuperVideoGame.png",
    required: false
  })
  iconUrl?: string;

  @ApiProperty({
    description: "The current status of the project",
    example: "IN_PROGRESS",
    enum: ["IN_PROGRESS", "COMPLETED", "ARCHIVED"]
  })
  status!: string;

  @ApiProperty({
    description: "The monetization strategy for this project",
    example: "NONE",
    enum: ["NONE", "ADS", "PAID"]
  })
  monetization!: string;

  @ApiProperty({
    example: 99.99,
    description: "The price of the project, if applicable",
    required: false
  })
  price?: number;

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

  // Relations

  @ApiProperty({
    description: "The users collaborating on this project",
    type: () => [Number]
  })
  collaborators!: number[];

  @ApiProperty({
    description: "Comments associated with this project",
    type: () => [Number]
  })
  comments!: number[];

  @ApiProperty({
    description: "Game sessions associated with this project",
    type: () => [Number]
  })
  gameSessions!: number[];

  @ApiProperty({
    description: "Work session associated with this project",
    type: () => Number,
    required: false
  })
  workSession?: number;
}
