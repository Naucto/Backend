import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request } from 'express';

import { CrashInput, CrashService } from './crash.service';

/** Anything but an HTTP exception below 500 is a failure of ours, not an answer. */
export function isServerCrash(exception: unknown): boolean {
  return (
    !(exception instanceof HttpException) ||
    exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR
  );
}

/** A request's crash, named by the route pattern it matched rather than by its URL. */
export function backendCrash(exception: unknown, request: Request): CrashInput {
  const error = exception instanceof Error ? exception : new Error(String(exception));
  const route: unknown = (request.route as { path?: unknown } | undefined)?.path;
  return {
    source: 'BACKEND',
    name: error.name,
    message: error.message,
    stack: error.stack ?? '',
    route: `${request.method} ${typeof route === 'string' ? route : 'unmatched'}`,
  };
}

/** Records every request that fails on our side, then answers it as Nest would. */
@Catch()
export class CrashCaptureFilter extends BaseExceptionFilter {
  constructor(private readonly crashes: CrashService) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http' && isServerCrash(exception)) {
      void this.crashes.recordSafely(
        backendCrash(exception, host.switchToHttp().getRequest<Request>()),
      );
    }
    super.catch(exception, host);
  }
}
