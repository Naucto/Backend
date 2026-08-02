import { ApiProperty } from "@nestjs/swagger";
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength
} from "class-validator";
import {
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_SHORT_DESC_MAX_LENGTH
} from "./project-field-limits";

export class CreateProjectDto {
  @ApiProperty({
    description: "The name of the project",
    example: "MySuperVideoGame",
    maxLength: PROJECT_NAME_MAX_LENGTH
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PROJECT_NAME_MAX_LENGTH)
  name!: string;

  @ApiProperty({
    description: "A short description of the project",
    example: "A 2D platformer game with pixel art graphics",
    maxLength: PROJECT_SHORT_DESC_MAX_LENGTH
  })
  @IsString()
  @MaxLength(PROJECT_SHORT_DESC_MAX_LENGTH)
  shortDesc!: string;

  @ApiProperty({
    description: "URL to the project icon",
    example: "https://example.com/icons/MySuperVideoGame.png",
    required: false
  })
  @IsUrl()
  @IsOptional()
  iconUrl?: string;

  @ApiProperty({
    description: "Tags attached to the project",
    example: ["Shooter", "Action"],
    required: false,
    type: [String]
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
