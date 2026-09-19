import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsOptional,
  IsArray,
  Length
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { PASSWORD_POLICY } from "@auth/password-policy";
import { PasswordStrength } from "@common/decorators/password-strength";
import { violation } from "@common/validation/violation";

export class CreateUserDto {
  @ApiProperty({
    description: "User email address",
    example: "user@example.com"
  })
  @IsEmail({}, { context: violation("EMAIL_INVALID") })
  @IsNotEmpty({ context: violation("EMAIL_REQUIRED") })
    email!: string;

  @ApiProperty({ description: "User username", example: "xX_DarkGamer_Xx" })
  @IsString()
  @Length(3, 20, {
    message: "Username must be between 3 and 20 characters",
    context: violation("USERNAME_LENGTH")
  })
    username!: string;

  @ApiProperty({
    description: "User nick name",
    example: "JohnDoe",
    required: false
  })
  @IsString()
  @IsOptional()
  @Length(3, 30, {
    message: "Nickname must be between 3 and 30 characters",
    context: violation("NICKNAME_LENGTH")
  })
    nickname?: string;

  @ApiProperty({
    description: "User password",
    example: "password123",
    minLength: PASSWORD_POLICY.minLength
  })
  @IsString()
  @MinLength(PASSWORD_POLICY.minLength, {
    message: `Password must be at least ${String(PASSWORD_POLICY.minLength)} characters`,
    context: violation("PASSWORD_TOO_SHORT")
  })
  @PasswordStrength({ context: violation("PASSWORD_TOO_WEAK") })
  @IsNotEmpty({ context: violation("PASSWORD_REQUIRED") })
    password!: string;

  @IsOptional()
  @IsArray()
    roles?: string[];
}
