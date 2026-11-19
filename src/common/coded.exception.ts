import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * A refusal that names itself with a `code` beside its message, for the cases a client answers
 * differently and cannot tell apart by status alone.
 */
export class CodedException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super({ statusCode: status, message, code, ...details }, status);
  }
}
