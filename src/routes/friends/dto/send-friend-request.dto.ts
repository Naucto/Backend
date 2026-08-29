import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Length, Min } from "class-validator";
import { AtLeastOne } from "@common/decorators/at-least-one";

export class SendFriendRequestDto {
  @ApiPropertyOptional({ description: "ID of the user to befriend" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @AtLeastOne(["userId", "friendCode"])
    userId?: number;

  @ApiPropertyOptional({
    description: "Friend code of the user to befriend (case-insensitive, dashes/spaces ignored)",
    example: "7K3Q-W9ZB"
  })
  @IsOptional()
  @IsString()
  @Length(8, 16)
    friendCode?: string;
}
