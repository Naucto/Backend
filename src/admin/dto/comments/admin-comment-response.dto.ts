import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PaginatedMetaDto } from "../admin-pagination.dto";

export class AdminCommentResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() projectId!: number;
  @ApiProperty() authorId!: number;
  @ApiPropertyOptional({ nullable: true }) parentId?: number | null;
  @ApiProperty() content!: string;
  @ApiProperty() deleted!: boolean;
  @ApiProperty() hidden!: boolean;
  @ApiPropertyOptional({ nullable: true }) hiddenReason?: string | null;
  @ApiPropertyOptional({ nullable: true }) hiddenAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) hiddenById?: number | null;
  @ApiProperty() createdAt!: string;
  @ApiPropertyOptional() authorUsername?: string;
  @ApiPropertyOptional() projectName?: string;
}

export class AdminCommentListResponseDto {
  @ApiProperty({ type: [AdminCommentResponseDto] })
  data!: AdminCommentResponseDto[];

  @ApiProperty({ type: PaginatedMetaDto })
  meta!: PaginatedMetaDto;
}
