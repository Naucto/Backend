import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsEnum, IsInt, Max, Min } from "class-validator";
import { Type } from "class-transformer";

export const USER_SORT_FIELDS = ["id", "username", "email", "createdAt"] as const;
const MAX_PAGE_SIZE = 100;

export class UserFilterDto {
  @ApiPropertyOptional({ description: "Page number", example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
    page?: number;

  @ApiPropertyOptional({ description: "Items per page", example: 10, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
    limit?: number;

  @ApiPropertyOptional({
    description: "Free-text search over username and nickname"
  })
  @IsOptional()
  @IsString()
    q?: string;

  @ApiPropertyOptional({ description: "Filter by nickname" })
  @IsOptional()
  @IsString()
    nickname?: string;

  @ApiPropertyOptional({ description: "Filter by email" })
  @IsOptional()
  @IsString()
    email?: string;

  @ApiPropertyOptional({
    enum: USER_SORT_FIELDS,
    description: "Sort by field"
  })
  @IsOptional()
  @IsEnum(USER_SORT_FIELDS)
    sortBy?: (typeof USER_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ["asc", "desc"], description: "Sort order" })
  @IsOptional()
  @IsEnum(["asc", "desc"])
    order?: "asc" | "desc";
}
