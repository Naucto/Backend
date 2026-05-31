import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional
} from "class-validator";
import { AdminPaginationDto } from "../admin-pagination.dto";

export class AdminCommentFilterDto extends AdminPaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  projectId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  authorId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value
  )
  @IsBoolean()
  hidden?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === "true" ? true : value === "false" ? false : value
  )
  @IsBoolean()
  deleted?: boolean;

  @ApiPropertyOptional({ enum: ["id", "createdAt"] })
  @IsOptional()
  @IsIn(["id", "createdAt"])
  override sortBy?: string;
}
