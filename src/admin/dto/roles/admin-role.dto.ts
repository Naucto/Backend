import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength
} from "class-validator";

export class CreateRoleDto {
  @ApiProperty({ example: "Editor" })
  @IsString()
  @IsNotEmpty()
  @Length(2, 40)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class UpdateRoleDto {
  @ApiProperty({ example: "Senior Editor" })
  @IsString()
  @IsNotEmpty()
  @Length(2, 40)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DeleteRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminRoleResponseDto {
  @ApiProperty() id!: number;
  @ApiProperty() name!: string;
  @ApiProperty() userCount!: number;
  @ApiProperty() canonical!: boolean;
}
