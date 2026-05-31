import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ModerationActionType,
  ModerationTargetType
} from "@prisma/client";
import { PaginatedMetaDto } from "../admin-pagination.dto";

export class ModerationLogResponseDto {
  @ApiProperty() id!: number;
  @ApiPropertyOptional({ nullable: true }) actorId?: number | null;
  @ApiPropertyOptional({ nullable: true }) actorLabel?: string | null;
  @ApiProperty({ enum: ModerationTargetType }) targetType!: ModerationTargetType;
  @ApiProperty() targetId!: number;
  @ApiProperty() targetLabel!: string;
  @ApiProperty({ enum: ModerationActionType }) action!: ModerationActionType;
  @ApiPropertyOptional({ nullable: true }) reason?: string | null;
  @ApiPropertyOptional({ nullable: true }) reportId?: number | null;
  @ApiProperty() createdAt!: string;
}

export class ModerationLogDetailDto extends ModerationLogResponseDto {
  @ApiPropertyOptional({ type: Object, nullable: true })
  before?: unknown;
  @ApiPropertyOptional({ type: Object, nullable: true })
  after?: unknown;
}

export class ModerationLogListResponseDto {
  @ApiProperty({ type: [ModerationLogResponseDto] })
  data!: ModerationLogResponseDto[];

  @ApiProperty({ type: PaginatedMetaDto })
  meta!: PaginatedMetaDto;
}
