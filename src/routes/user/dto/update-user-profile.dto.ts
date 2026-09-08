import { ApiPropertyOptional } from "@nestjs/swagger";
import { PersonalColour } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description: "Public nickname / bio displayed on the profile",
    example: "Jojo",
    maxLength: 160
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
    nickname?: string;
  @ApiPropertyOptional({
    description: "Public profile description displayed on the profile",
    example: "I love making games",
    maxLength: 160
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
    description?: string;

  @ApiPropertyOptional({
    description: "The accent this person is drawn in",
    enum: PersonalColour,
    example: PersonalColour.SKY
  })
  @IsOptional()
  @IsEnum(PersonalColour)
    colour?: PersonalColour;
}

