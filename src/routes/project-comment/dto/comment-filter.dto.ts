import { PaginationDto } from "@common/dto/pagination.dto";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
} from "class-validator";

const asBoolean = ({ value }: { value: unknown }): unknown =>
  value === "true" ? true : value === "false" ? false : value;

/** Cross-project comment query. The moderation filters are staff-only. */
export class CommentFilterDto extends PaginationDto {
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
  override sortBy?: string;

}
