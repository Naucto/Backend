import { ApiProperty } from '@nestjs/swagger';

export const COMMENT_REMOVALS = ['USER', 'MODERATION'] as const;
export type CommentRemoval = (typeof COMMENT_REMOVALS)[number];

export class CommentAuthorDto {
  @ApiProperty({ format: 'uuid', example: '3f2b8c1e-9d4a-4e6f-8a7b-1c2d3e4f5a6b' })
  id!: string;

  @ApiProperty({ example: 'john_doe' })
  username!: string;

  @ApiProperty({
    example: 'John',
    nullable: true,
    type: String,
    required: false,
  })
  nickname?: string | null;
}

export class CommentResponseDto {
  @ApiProperty({ format: 'uuid', example: '9b2f7a4c-1d3e-4f5a-8b6c-7d8e9f0a1b2c' })
  id!: string;

  @ApiProperty({ example: 'Great game!' })
  content!: string;

  @ApiProperty({ example: '2023-04-15T12:00:00Z' })
  createdAt!: Date;

  @ApiProperty({ format: 'uuid', example: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
  projectId!: string;

  @ApiProperty({ type: CommentAuthorDto })
  author!: CommentAuthorDto;

  @ApiProperty({ example: false, required: false })
  deleted?: boolean;

  @ApiProperty({
    enum: COMMENT_REMOVALS,
    enumName: 'CommentRemoval',
    required: false,
    description: 'Who removed a deleted comment: its author or the game creator, or moderation',
  })
  removedBy?: CommentRemoval;

  @ApiProperty({
    type: () => [CommentResponseDto],
    required: false,
    description: 'Replies to this comment (only for top-level comments)',
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
