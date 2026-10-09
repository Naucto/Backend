import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

import { AccountSummaryDto } from './admin-account.dto';

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

/**
 * An admin session: the access token in the body, and the httpOnly session cookie, set beside it,
 * that `admin/auth/refresh` renews it from.
 */
export class AdminSessionDto {
  @ApiProperty({ description: 'Bearer token for the admin routes' })
  accessToken!: string;

  @ApiProperty({ description: 'Seconds the access token is valid for' })
  expiresIn!: number;

  @ApiProperty({ type: AccountSummaryDto })
  account!: AccountSummaryDto;
}
