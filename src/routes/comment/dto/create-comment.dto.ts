import { IsString, MinLength, MaxLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateCommentDto {
  @ApiProperty({
    description: "The content of the comment",
    example: "Great game, love the pixel art!",
    minLength: 1,
    maxLength: 2000
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
