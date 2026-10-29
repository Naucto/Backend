import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import { PasswordStrength } from '../../common/decorators/password-strength';
import { violation } from '../../common/validation/violation';
import { PASSWORD_POLICY } from '../password-policy';

/** Long enough for any token we mint, short enough that nobody posts a megabyte through it. */
const TOKEN_MAX_LENGTH = 128;

export class EmailAddressDto {
  @ApiProperty({ description: 'Address of the account', example: 'user@example.com' })
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token from the link mailed at registration' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the link mailed by forgot-password' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(TOKEN_MAX_LENGTH)
  token!: string;

  @ApiProperty({ description: 'New password', minLength: PASSWORD_POLICY.minLength })
  @IsString()
  @IsNotEmpty({ context: violation('PASSWORD_REQUIRED') })
  @MinLength(PASSWORD_POLICY.minLength, {
    message: `Password must be at least ${String(PASSWORD_POLICY.minLength)} characters`,
    context: violation('PASSWORD_TOO_SHORT'),
  })
  @PasswordStrength({ context: violation('PASSWORD_TOO_WEAK') })
  newPassword!: string;
}

export class RegisterResponseDto {
  @ApiProperty({
    description:
      'Address the confirmation link was sent to; the account signs in once it is followed',
    example: 'user@example.com',
  })
  email!: string;
}
