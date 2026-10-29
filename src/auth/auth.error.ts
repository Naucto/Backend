import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';

/** Codes a client branches on, carried next to the message of the two rejections below. */
export type AuthErrorCode = 'EMAIL_NOT_VERIFIED' | 'INVALID_EMAIL_TOKEN';

export function emailNotVerified(): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    message: 'Confirm your email address before signing in',
    code: 'EMAIL_NOT_VERIFIED' satisfies AuthErrorCode,
  });
}

export function invalidEmailToken(): BadRequestException {
  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: 'This link is invalid or has expired',
    code: 'INVALID_EMAIL_TOKEN' satisfies AuthErrorCode,
  });
}
