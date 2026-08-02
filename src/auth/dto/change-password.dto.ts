import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty({
    description: "Current password (not required for OAuth accounts)",
    required: false
  })
  @IsString()
  @IsOptional()
  currentPassword?: string;

  @ApiProperty({
    description: "New password",
    minLength: 6
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: "Password must be at least 6 characters" })
  newPassword!: string;
}
