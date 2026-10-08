import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

import { AdminAccountDto } from './admin-account.dto';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class AdminTwoFactorLoginDto {
  @ApiProperty({ description: 'The challenge the password step answered with' })
  @IsString()
  @IsNotEmpty()
  challengeToken!: string;

  @ApiProperty({ example: '123456', description: 'The 6-digit code from the authenticator' })
  @IsString()
  @Matches(/^\s*\d{3}\s?\d{3}\s*$/, { message: 'The code is 6 digits' })
  code!: string;
}

export const ADMIN_LOGIN_STATUSES = ['authenticated', 'two_factor_required'] as const;
export type AdminLoginStatus = (typeof ADMIN_LOGIN_STATUSES)[number];

/**
 * A finished sign-in carries an access token, and sets the httpOnly session cookie that
 * `admin/auth/refresh` renews it from. A password alone, for an account with two-factor sign-in,
 * carries only a challenge for the code step.
 */
export class AdminSessionDto {
  @ApiProperty({ enum: ADMIN_LOGIN_STATUSES })
  status!: AdminLoginStatus;

  @ApiPropertyOptional({ description: 'Bearer token for the admin routes' })
  accessToken?: string;

  @ApiPropertyOptional({ description: 'Seconds the access token is valid for' })
  expiresIn?: number;

  @ApiPropertyOptional({ description: 'Valid five minutes, for `admin/auth/two-factor`' })
  challengeToken?: string;

  @ApiPropertyOptional({ type: AdminAccountDto })
  account?: AdminAccountDto;
}
