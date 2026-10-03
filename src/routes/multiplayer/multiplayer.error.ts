export class MultiplayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerInvalidStateError extends MultiplayerError {}

export class MultiplayerUserAlreadyJoinedError extends MultiplayerError {}

export class MultiplayerUserNotInSessionError extends MultiplayerError {}

export class MultiplayerGameSessionNotFoundError extends MultiplayerError {}

export class MultiplayerUserNotFoundError extends MultiplayerError {}

export class MultiplayerForbiddenError extends MultiplayerError {}

export class MultiplayerSessionFullError extends MultiplayerError {}

export class MultiplayerInvalidJoinCodeError extends MultiplayerError {}
