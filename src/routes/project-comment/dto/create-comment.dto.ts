import { Transform } from "class-transformer";
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import {
  COMMENT_MAX_CONSECUTIVE_LINE_BREAKS,
  COMMENT_MAX_LENGTH,
  COMMENT_MAX_LINE_BREAKS,
  hasMaxLineBreaks,
  normalizeCommentContent,
} from "src/util/comment-content.util";

export class CreateCommentDto {
  @ApiProperty({
    description: "The content of the comment",
    example: "Great game, love the pixel art!",
    minLength: 1,
    maxLength: COMMENT_MAX_LENGTH
  })
  @Transform(({ value }) =>
    typeof value === "string" ? normalizeCommentContent(value) : value
  )
  @IsString()
  @MinLength(1)
  @MaxLength(COMMENT_MAX_LENGTH)
  @Matches(new RegExp(`^(?!.*\\n{${COMMENT_MAX_CONSECUTIVE_LINE_BREAKS + 1},})[\\s\\S]*$`), {
    message: `Comment cannot contain more than ${COMMENT_MAX_CONSECUTIVE_LINE_BREAKS} consecutive line breaks`,
  })
  @hasMaxLineBreaks(COMMENT_MAX_LINE_BREAKS, {
    message: `Comment cannot contain more than ${COMMENT_MAX_LINE_BREAKS} line breaks`,
  })
  content!: string;
}
