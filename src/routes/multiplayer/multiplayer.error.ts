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

// FIXME: This should rather be in a src/routes/user/user.error.ts file.
//        Also, this should be thrown by the user service, evidently.
//        Will do a lot of clean-up with the backend.
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
