import { ApiProperty } from "@nestjs/swagger";

export class ProjectActionResponseDto {
  @ApiProperty({ example: "Project published successfully" })
    message!: string;

  @ApiProperty({ example: 1, description: "The project acted on" })
    id!: number;
}

export class VersionDeletedResponseDto {
  @ApiProperty({ example: "Version deleted successfully" })
    message!: string;

  @ApiProperty({
    example: "1742901234567",
    description: "Name of the deleted autosave"
  })
    name!: string;
}
