import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

import {
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  HANDLE_PATTERN_MESSAGE,
} from '../../../auth/handle-policy';
import { PASSWORD_POLICY } from '../../../auth/password-policy';
import { PasswordStrength } from '../../../common/decorators/password-strength';
import { violation } from '../../../common/validation/violation';

export class CreateUserDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
  })
  @IsEmail({}, { context: violation('EMAIL_INVALID') })
  @IsNotEmpty({ context: violation('EMAIL_REQUIRED') })
  email!: string;

  @ApiProperty({
    description: 'User username',
    example: 'xX_DarkGamer_Xx',
    minLength: HANDLE_MIN,
    maxLength: HANDLE_MAX,
    pattern: HANDLE_PATTERN.source,
  })
  @IsString()
  @Length(HANDLE_MIN, HANDLE_MAX, {
    message: `Username must be between ${String(HANDLE_MIN)} and ${String(HANDLE_MAX)} characters`,
    context: violation('USERNAME_LENGTH'),
  })
  @Matches(HANDLE_PATTERN, {
    message: HANDLE_PATTERN_MESSAGE,
    context: violation('USERNAME_INVALID'),
  })
  username!: string;

  @ApiProperty({
    description: 'User nick name',
    example: 'JohnDoe',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Length(3, 30, {
    message: 'Nickname must be between 3 and 30 characters',
    context: violation('NICKNAME_LENGTH'),
  })
  nickname?: string;

  @ApiProperty({
    description: 'User password',
    example: 'password123',
    minLength: PASSWORD_POLICY.minLength,
  })
  @IsString()
  @MinLength(PASSWORD_POLICY.minLength, {
    message: `Password must be at least ${String(PASSWORD_POLICY.minLength)} characters`,
    context: violation('PASSWORD_TOO_SHORT'),
  })
  @PasswordStrength({ context: violation('PASSWORD_TOO_WEAK') })
  @IsNotEmpty({ context: violation('PASSWORD_REQUIRED') })
  password!: string;
}
