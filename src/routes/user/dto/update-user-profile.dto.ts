import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description: "Public nickname / bio displayed on the profile",
    example: "I love making games",
    maxLength: 160
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
    nickname?: string;
}

