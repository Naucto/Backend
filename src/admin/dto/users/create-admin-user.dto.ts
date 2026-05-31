import { ApiProperty } from "@nestjs/swagger";
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MinLength
} from "class-validator";

export class CreateAdminUserDto {
  @ApiProperty({ example: "moderator@naucto.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "mod_jane" })
  @IsString()
  @Length(3, 20)
  username!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 30)
  nickname?: string;

  @ApiProperty({ example: "********" })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ type: [String], example: ["Moderator"] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsString({ each: true })
  roles!: string[];
}
