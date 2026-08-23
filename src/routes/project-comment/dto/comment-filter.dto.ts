import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min
} from "class-validator";

const asBoolean = ({ value }: { value: unknown }): unknown =>
  value === "true" ? true : value === "false" ? false : value;

/** Cross-project comment query. The moderation filters are staff-only. */
export class CommentFilterDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: "Only comments on this project" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  projectId?: number;

  @ApiPropertyOptional({ description: "Only comments by this author" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  authorId?: number;

  @ApiPropertyOptional({ description: "Moderators only" })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional({ description: "Moderators only" })
  @IsOptional()
  @Transform(asBoolean)
  @IsBoolean()
  deleted?: boolean;

  @ApiPropertyOptional({ enum: ["id", "createdAt"] })
  @IsOptional()
  @IsIn(["id", "createdAt"])
  sortBy?: string;

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsIn(["asc", "desc"])
  order?: "asc" | "desc";
}
