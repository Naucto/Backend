import { ApiProperty } from "@nestjs/swagger";

export class ContentSizeBreakdownDto {
  @ApiProperty({ example: 2048, description: "UTF-8 bytes of Lua source" })
    code!: number;

  @ApiProperty({ example: 512, description: "Painted sprite-sheet pixels" })
    sprites!: number;

  @ApiProperty({ example: 4, description: "Sprites with at least one flag set" })
    flags!: number;

  @ApiProperty({ example: 300, description: "Map tiles set" })
    map!: number;

  @ApiProperty({
    example: 1024,
    description: "UTF-8 bytes of instruments, patterns, songs, sfx and samples"
  })
    sound!: number;

  @ApiProperty({ example: 112, description: "Bytes of the colour palette" })
    palette!: number;

  @ApiProperty({ example: 4000, description: "Sum of every category" })
    total!: number;

  @ApiProperty({
    example: 1,
    description: "Game document schema version (0 = legacy document)"
  })
    schemaVersion!: number;
}

export class ProjectLimitsDto {
  @ApiProperty({
    example: 1048576,
    description: "Maximum logical content size (bytes) a game can be published at"
  })
    maxContentBytes!: number;

  @ApiProperty({
    example: 16777216,
    description: "Maximum size (bytes) of an uploaded project blob"
  })
    maxBlobBytes!: number;
}

export class ProjectSizeDto {
  @ApiProperty({ example: 1, description: "Project ID" })
    projectId!: number;

  @ApiProperty({ type: ContentSizeBreakdownDto })
    contentSize!: ContentSizeBreakdownDto;

  @ApiProperty({
    example: 1048576,
    description: "Maximum logical content size (bytes) a game can be published at"
  })
    maxContentBytes!: number;

  @ApiProperty({
    example: true,
    description: "Whether the project fits within the publishing budget"
  })
    withinBudget!: boolean;
}

export class ProjectTooLargeDto {
  @ApiProperty({ example: 413 })
    statusCode!: number;

  @ApiProperty({ example: "Payload Too Large" })
    error!: string;

  @ApiProperty({ example: "PROJECT_TOO_LARGE" })
    code!: string;

  @ApiProperty({
    example: "Project content is 1200000 bytes, above the 1048576 bytes limit"
  })
    message!: string;

  @ApiProperty({ type: ContentSizeBreakdownDto })
    contentSize!: ContentSizeBreakdownDto;

  @ApiProperty({ example: 1048576 })
    maxContentBytes!: number;
}
