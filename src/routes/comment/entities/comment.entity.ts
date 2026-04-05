import { ApiProperty } from "@nestjs/swagger";

export class CommentEntity {
  @ApiProperty({ example: 1 })
  id!: number;

  @ApiProperty({ example: "Great game!" })
  content!: string;

  @ApiProperty({ example: 1 })
  authorId!: number;

  @ApiProperty({ example: 1 })
  projectId!: number;

  @ApiProperty({ example: null, nullable: true })
  parentId?: number | null;

  @ApiProperty({ example: "2023-04-15T12:00:00Z" })
  createdAt!: Date;
}
