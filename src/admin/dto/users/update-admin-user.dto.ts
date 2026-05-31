import { ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength
} from "class-validator";

export class UpdateAdminUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 20)
  username?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 30)
  nickname?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roles?: string[];

  @ApiPropertyOptional({
    description: "Free-form audit reason, recorded in the moderation log"
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
