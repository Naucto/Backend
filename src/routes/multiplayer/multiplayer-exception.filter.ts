import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpErrorByCode } from '@nestjs/common/utils/http-error-by-code.util';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request } from 'express';

import { MultiplayerError } from './multiplayer.error';

/**
 * Answers a failure of a multiplayer route: an HTTP exception as raised, a `MultiplayerError` with
 * its own status, and anything else with a 500 that names no cause, the cause going to the log.
 */
@Catch()
export class MultiplayerExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(MultiplayerExceptionFilter.name);

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      super.catch(exception, host);
      return;
    }

    if (
      exception instanceof MultiplayerError &&
      exception.status !== HttpStatus.INTERNAL_SERVER_ERROR
    ) {
      super.catch(new HttpErrorByCode[exception.status](exception.message), host);
      return;
    }

    const request = host.switchToHttp().getRequest<Request>();

    this.logger.error(
      `Error while answering ${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    super.catch(new InternalServerErrorException(), host);
  }
}
