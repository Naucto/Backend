import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";
import { PASSWORD_POLICY } from "@auth/password-policy";
import { PasswordStrength } from "@common/decorators/password-strength";
import { violation } from "@common/validation/violation";

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
    minLength: PASSWORD_POLICY.minLength
  })
  @IsString()
  @IsNotEmpty({ context: violation("PASSWORD_REQUIRED") })
  @MinLength(PASSWORD_POLICY.minLength, {
    message: `Password must be at least ${String(PASSWORD_POLICY.minLength)} characters`,
    context: violation("PASSWORD_TOO_SHORT")
  })
  @PasswordStrength({ context: violation("PASSWORD_TOO_WEAK") })
    newPassword!: string;
}
