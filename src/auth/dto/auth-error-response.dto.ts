import { ApiProperty } from '@nestjs/swagger';

import { AUTH_ERROR_CODES, AuthErrorCode } from '../auth.error';

/** A sign-in flow rejection a client tells apart by `code` rather than by its prose. */
export class AuthErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({ example: 'This link is invalid or has expired' })
  message!: string;

  @ApiProperty({
    enum: AUTH_ERROR_CODES,
    enumName: 'AuthErrorCode',
    example: 'INVALID_EMAIL_TOKEN',
  })
  code!: AuthErrorCode;
}
