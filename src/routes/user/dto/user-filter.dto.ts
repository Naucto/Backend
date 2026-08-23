import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsEnum, IsInt, Min } from "class-validator";
import { Type } from "class-transformer";
import { AccountStatus } from "@prisma/client";

export class UserFilterDto {
  @ApiPropertyOptional({ description: "Page number", example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: "Items per page", example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: "Filter by nickname" })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional({ description: "Filter by email" })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: "Filter by username" })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({
    enum: AccountStatus,
    description: "Filter by account status. Moderators only."
  })
  @IsOptional()
  @IsEnum(AccountStatus)
  accountStatus?: AccountStatus;

  @ApiPropertyOptional({
    description: "Only users holding this role. Moderators only.",
    example: "Moderator"
  })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({
    enum: ["id", "username", "email", "createdAt"],
    description: "Sort by field"
  })
  @IsOptional()
  @IsEnum(["id", "username", "email", "createdAt"])
  sortBy?: string;

  @ApiPropertyOptional({ enum: ["asc", "desc"], description: "Sort order" })
  @IsOptional()
  @IsEnum(["asc", "desc"])
  order?: "asc" | "desc";
}
