import { ApiPropertyOptional } from "@nestjs/swagger";
import { MonetizationType } from "@prisma/client";
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength
} from "class-validator";

export class AdminUpdateProjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) shortDesc?: string;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  longDesc?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  publishedName?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  publishedShortDesc?: string | null;
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  publishedLongDesc?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  publishedTags?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  iconUrl?: string | null;

  @ApiPropertyOptional({ enum: MonetizationType })
  @IsOptional()
  @IsEnum(MonetizationType)
  monetization?: MonetizationType;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber()
  price?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hiddenReason?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
