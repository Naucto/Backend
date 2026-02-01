export class MultiplayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerInvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerHostOpenedError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerHostInvalidError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerHostNotFoundError extends MultiplayerError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class MultiplayerUserDoesNotExistError extends MultiplayerError {
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
