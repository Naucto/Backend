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
