import { ApiPropertyOptional } from "@nestjs/swagger";
import { PersonalColour } from "@prisma/client";
import {
  IsEnum,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf
} from "class-validator";

const HANDLE = /^[a-zA-Z0-9._-]+$/;

export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description: "Display name shown on the profile",
    example: "Jojo",
    maxLength: 160
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(160)
    nickname?: string;
  @ApiPropertyOptional({
    description: "Public profile description displayed on the profile",
    example: "I love making games",
    maxLength: 160
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(160)
    description?: string;

  @ApiPropertyOptional({
    description: "Handle, unique across the platform — people add you as a friend with it",
    example: "louis",
    minLength: 3,
    maxLength: 24
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(24)
  @Matches(HANDLE, {
    message: "A handle may hold letters, digits, dots, dashes and underscores"
  })
    username?: string;

  @ApiPropertyOptional({
    description: "The accent this person is drawn in",
    enum: PersonalColour,
    example: PersonalColour.SKY
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(PersonalColour)
    colour?: PersonalColour;
}

