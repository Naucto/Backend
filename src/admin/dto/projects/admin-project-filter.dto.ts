import { ApiPropertyOptional } from "@nestjs/swagger";
import { ProjectStatus } from "@prisma/client";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString
} from "class-validator";
import { AdminPaginationDto } from "../admin-pagination.dto";

export class AdminProjectFilterDto extends AdminPaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value
  )
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  userId?: number;

  @ApiPropertyOptional({
    enum: ["id", "name", "createdAt", "updatedAt", "publishedAt", "likes", "viewCount"]
  })
  @IsOptional()
  @IsIn([
    "id",
    "name",
    "createdAt",
    "updatedAt",
    "publishedAt",
    "likes",
    "viewCount"
  ])
  override sortBy?: string;
}
