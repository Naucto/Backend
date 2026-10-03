import { HttpStatus } from '@nestjs/common';
import { ErrorHttpStatusCode } from '@nestjs/common/utils/http-error-by-code.util';

/**
 * A failure the multiplayer routes answer with `status`; a 500 is answered without its message, which
 * may describe the server's internals.
 */
export class MultiplayerError extends Error {
  readonly status: ErrorHttpStatusCode = HttpStatus.INTERNAL_SERVER_ERROR;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerInvalidStateError extends MultiplayerError {}

export class MultiplayerUserAlreadyJoinedError extends MultiplayerError {
  override readonly status = HttpStatus.CONFLICT;
}

export class MultiplayerUserNotInSessionError extends MultiplayerError {
  override readonly status = HttpStatus.BAD_REQUEST;
}

export class MultiplayerGameSessionNotFoundError extends MultiplayerError {
  override readonly status = HttpStatus.NOT_FOUND;
}

export class MultiplayerUserNotFoundError extends MultiplayerError {
  override readonly status = HttpStatus.NOT_FOUND;
}

export class MultiplayerForbiddenError extends MultiplayerError {
  override readonly status = HttpStatus.FORBIDDEN;
}

export class MultiplayerSessionFullError extends MultiplayerError {
  override readonly status = HttpStatus.CONFLICT;
}

export class MultiplayerInvalidJoinCodeError extends MultiplayerError {
  override readonly status = HttpStatus.BAD_REQUEST;
}
