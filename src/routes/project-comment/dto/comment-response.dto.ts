import { ApiProperty } from "@nestjs/swagger";

export class CommentAuthorDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: "john_doe" })
  username!: string;

  @ApiProperty({ example: "John", nullable: true, type: String, required: false })
  nickname?: string | null;
}

export class CommentResponseDto {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: "Great game!" })
  content!: string;

  @ApiProperty({ example: "2023-04-15T12:00:00Z" })
  createdAt!: Date;

  @ApiProperty({ example: 1 })
  projectId!: number;

  @ApiProperty({ type: CommentAuthorDto })
  author!: CommentAuthorDto;

  @ApiProperty({ example: false, required: false })
  deleted?: boolean;

  @ApiProperty({
    type: () => [CommentResponseDto],
    required: false,
    description: "Replies to this comment (only for top-level comments)"
  })
  replies?: CommentResponseDto[] | undefined;
}

export class PaginatedCommentsResponseDto {
  @ApiProperty({ type: [CommentResponseDto] })
  comments!: CommentResponseDto[];

  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}
