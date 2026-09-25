import { Permission } from "@auth/permissions";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsNotEmpty,
  IsArray,
  IsEnum,
  ArrayUnique,
  IsOptional,
  IsString,
  Length,
  MaxLength
} from "class-validator";

export class CreateRoleDto {

  @ApiPropertyOptional({ enum: Permission, enumName: "Permission", isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];

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

  @ApiPropertyOptional({ enum: Permission, enumName: "Permission", isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];

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
  @ApiProperty({ enum: Permission, enumName: "Permission", isArray: true })
  permissions!: Permission[];
}
