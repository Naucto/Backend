import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsString, Length, Min, ValidateIf } from "class-validator";

export class SendFriendRequestDto {
  @ApiPropertyOptional({ description: "ID of the user to befriend" })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
    userId?: number;

  @ApiPropertyOptional({
    description: "Handle of the person to befriend — what the profile shows after the @",
    example: "louis"
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(3, 24)
    username?: string;

  @ApiPropertyOptional({
    description: "Friend code of the user to befriend (case-insensitive, dashes/spaces ignored)",
    example: "7K3Q-W9ZB"
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(8, 16)
    friendCode?: string;
}
