import { BadRequestException, ForbiddenException, HttpStatus } from '@nestjs/common';

/** Codes a client branches on, carried next to the message of the two rejections below. */
export const AUTH_ERROR_CODES = ['EMAIL_NOT_VERIFIED', 'INVALID_EMAIL_TOKEN'] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

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
