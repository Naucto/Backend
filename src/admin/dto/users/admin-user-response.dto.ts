import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AccountStatus } from "@prisma/client";
import { PaginatedMetaDto } from "../admin-pagination.dto";

export class AdminUserResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() email!: string;
  @ApiProperty() username!: string;
  @ApiPropertyOptional({ nullable: true }) nickname?: string | null;
  @ApiProperty({ enum: AccountStatus }) accountStatus!: AccountStatus;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty() createdAt!: string;
}

export class AdminUserListResponseDto {
  @ApiProperty({ type: [AdminUserResponseDto] })
    data!: AdminUserResponseDto[];

  @ApiProperty({ type: PaginatedMetaDto })
    meta!: PaginatedMetaDto;
}

export class AdminUserDetailDto extends AdminUserResponseDto {
  @ApiProperty() projectsCreatedCount!: number;
  @ApiProperty() commentsCount!: number;
  @ApiProperty() reportsFiledCount!: number;
  @ApiProperty() moderationActionsTakenCount!: number;
}
