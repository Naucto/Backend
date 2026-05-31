import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MonetizationType, ProjectStatus } from "@prisma/client";
import { PaginatedMetaDto } from "../admin-pagination.dto";

export class AdminProjectResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() shortDesc!: string;
  @ApiPropertyOptional({ nullable: true }) longDesc?: string | null;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: [String] }) publishedTags!: string[];
  @ApiPropertyOptional({ nullable: true }) publishedName?: string | null;
  @ApiPropertyOptional({ nullable: true }) publishedShortDesc?: string | null;
  @ApiPropertyOptional({ nullable: true }) publishedLongDesc?: string | null;
  @ApiPropertyOptional({ enum: ProjectStatus, nullable: true })
  status?: ProjectStatus | null;
  @ApiPropertyOptional({ nullable: true }) iconUrl?: string | null;
  @ApiPropertyOptional({ enum: MonetizationType, nullable: true })
  monetization?: MonetizationType | null;
  @ApiPropertyOptional({ nullable: true }) price?: number | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiPropertyOptional({ nullable: true }) publishedAt?: string | null;
  @ApiProperty() userId!: number;
  @ApiProperty() hidden!: boolean;
  @ApiPropertyOptional({ nullable: true }) hiddenReason?: string | null;
  @ApiPropertyOptional({ nullable: true }) hiddenAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) hiddenById?: number | null;
  @ApiProperty() viewCount!: number;
  @ApiProperty() likes!: number;
}

export class AdminProjectListResponseDto {
  @ApiProperty({ type: [AdminProjectResponseDto] })
  data!: AdminProjectResponseDto[];

  @ApiProperty({ type: PaginatedMetaDto })
  meta!: PaginatedMetaDto;
}
