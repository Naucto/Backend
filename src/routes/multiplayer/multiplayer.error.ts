export class MultiplayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerInvalidStateError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerUserAlreadyJoinedError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerUserNotInSessionError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerGameSessionNotFoundError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// The caller is not the host of the session and tried a host-only action.
export class MultiplayerForbiddenError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerSessionFullError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerInvalidJoinCodeError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
