import { ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import { CreateCommentDto } from "./create-comment.dto";

/**
 * Editing a comment through the ordinary route.
 *
 * `hidden` and `moderationReason` are staff-only: the service rejects them from
 * a non-moderator. They live here rather than on a separate admin endpoint so
 * there is one way to change a comment, whoever is changing it.
 */
export class UpdateCommentDto extends PartialType(CreateCommentDto) {
  @ApiPropertyOptional({
    description: "Take the comment off the site, or put it back. Moderators only.",
    example: true
  })
  @IsBoolean()
  @IsOptional()
  hidden?: boolean;

  @ApiPropertyOptional({
    description: "Why the moderation change was made; recorded on the audit entry.",
    maxLength: 500
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  moderationReason?: string;
}
